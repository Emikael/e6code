/**
 * Thread-scoped right-panel surface state.
 *
 * This is intentionally a shallow workspace model: it owns an ordered set of
 * surface descriptors and the active surface, while each feature continues to
 * own its durable resource state. Browser surfaces point at preview tab ids,
 * terminal surfaces point at terminal session ids, file surfaces point at
 * workspace paths, and diff/files remain singleton surfaces. The Files surface
 * holds the explorer and the file it shows: opening a file navigates it rather
 * than adding a tab, and "Keep as its own tab" makes a per-file surface.
 *
 * A thread's panel rests on Run details: an open panel with no active surface
 * shows it, so closing or leaving a surface returns there instead of to a
 * neighbouring tab. The pull-request list's shared panel has no resting view
 * and keeps the older behaviour of falling back to a neighbour, then hiding.
 */
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@e6tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  type ChatFileAttachment,
  type ScopedThreadRef,
} from "@e6tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useClosedViewStore } from "./closedViewStore";
import { resolveStorage } from "./lib/storage";

const RIGHT_PANEL_KINDS = [
  "diff",
  "files",
  "file",
  "preview",
  "device",
  "terminal",
  "pull-request",
  "pull-requests",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export interface DeviceTabTarget {
  hostId: string;
  deviceId: string;
  platform: "ios" | "android";
  name: string;
}

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string }
  | { id: "browser:new"; kind: "preview"; resourceId: null }
  | { id: "device" | `device:${string}`; kind: "device"; target?: DeviceTabTarget; title?: string }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
    }
  | { id: "diff"; kind: "diff" }
  | {
      id: "files";
      kind: "files";
      /** The workspace file (or folder) the Files tab shows beside its explorer. */
      relativePath?: string;
      revealLine?: number | null;
      revealRequestId?: number;
    }
  | {
      id: `file:${string}` | `attachment:${string}`;
      kind: "file";
      /** Workspace-relative, or absolute for a host file outside the workspace. */
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
      /** Present when the file lives in the thread's attachment store rather
          than at a workspace or host path. */
      attachment?: ChatFileAttachment;
    }
  | {
      /**
       * A change request opened beside a thread or in the pull-request list's shared panel.
       * The reference lives in the id so several pull requests can remain open as peer tabs.
       */
      id: `pull-request:${string}`;
      kind: "pull-request";
      /**
       * Which server the change request was read from. The list spans every connected one, so
       * two of them can hold the same project id; a panel beside a thread leaves this out and
       * takes the environment from its own ref.
       */
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
    }
  /** The thread's linked pull requests, one singleton tab beside any number of `pull-request` tabs. */
  | { id: "pull-requests"; kind: "pull-requests" };

const RIGHT_PANEL_STORAGE_KEY = "e6code:right-panel-state:v2";
// v9 removed the "plan" surface kind (plans render inline in the transcript).
// v10 keys pull-request surfaces by reference instead of a singleton tab.
// v11 stops persisting the pull-request list's shared panel, so a restart opens the page fresh.
// v12 adds the device surface.
// v14 drops the "agents" (Overview) surface: Run details is the panel's resting view.
// v15 folds the per-file tabs into the one Files tab, which now shows the file it opened.
const RIGHT_PANEL_STORAGE_VERSION = 15;

/** A fixed workspace-level ref: each PR surface carries its own real environment. */
export const PULL_REQUESTS_PANEL_REF = scopeThreadRef(
  EnvironmentId.make("pull-requests-panel"),
  ThreadId.make("pull-requests-panel"),
);

/**
 * The pull-request list's shared panel is session
 * state: reopening the app should show the list, not last session's tabs and detail fetches.
 */
const isPullRequestsPanelKey = (threadKey: string) => threadKey.endsWith(":pull-requests-panel");

/** Whether a panel rests on Run details. Threads do; the pull-request list's shared panel does not. */
const panelRestsOnRunDetails = (threadKey: string) => !isPullRequestsPanelKey(threadKey);

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
  dismissedDeviceSurfaceIds?: string[];
  /** Kept with the thread so the layout survives a ChatView remount or a reload. */
  maximized?: true;
}

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  /**
   * The last open/close choice for the whole panel. A thread with no panel record of its own
   * follows it, so Run details shows on every thread until the user hides the panel.
   */
  restingOpen: boolean;
  /** Session-only count of user panel choices per thread. Automatic updates do not advance it. */
  userActionRevisionByThreadKey: Record<string, number>;
  closeRevisionByThreadKey: Record<string, number>;
  getUserActionRevision: (ref: ScopedThreadRef) => number;
  /**
   * Open a surface on behalf of the app, not the user. Refused when the user
   * made a panel choice after `expectedUserActionRevision` was read.
   */
  openProactive: (
    ref: ScopedThreadRef,
    surface: Extract<RightPanelSurface, { kind: "diff" | "pull-request" | "pull-requests" }>,
    expectedUserActionRevision: number,
  ) => boolean;
  open: (
    ref: ScopedThreadRef,
    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request">,
  ) => void;
  openDevice: (ref: ScopedThreadRef, target: DeviceTabTarget, automatic?: boolean) => void;
  renameDevice: (ref: ScopedThreadRef, surfaceId: string, title: string) => void;
  openBrowser: (ref: ScopedThreadRef, tabId: string | null) => void;
  /**
   * Shows a workspace file: in its own tab when one was kept for it, otherwise in the Files tab,
   * which navigates rather than adding a tab.
   */
  openFile: (ref: ScopedThreadRef, relativePath: string, line?: number) => void;
  /** "Keep as its own tab": moves the file out of the Files tab into a per-file tab. */
  keepFileAsTab: (ref: ScopedThreadRef, relativePath: string) => void;
  openAttachment: (ref: ScopedThreadRef, attachment: ChatFileAttachment) => void;
  openPullRequest: (
    ref: ScopedThreadRef,
    target: {
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
    },
  ) => void;
  openTerminal: (ref: ScopedThreadRef, terminalId: string) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
  ) => void;
  activateTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  closeTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeAllSurfaces: (ref: ScopedThreadRef) => void;
  moveSurface: (ref: ScopedThreadRef, surfaceId: string, toIndex: number) => void;
  reconcileBrowserSurfaces: (ref: ScopedThreadRef, tabIds: readonly string[]) => void;
  reconcileFileSurfaces: (ref: ScopedThreadRef, workspaceAvailable: boolean) => void;
  show: (ref: ScopedThreadRef) => void;
  /**
   * `remember: false` hides the panel on this thread without changing what untouched threads
   * show, for a narrow-window sheet that is dismissed far more often than a docked panel.
   */
  close: (ref: ScopedThreadRef, options?: { remember?: boolean }) => void;
  setMaximized: (ref: ScopedThreadRef, maximized: boolean) => void;
  toggleVisibility: (ref: ScopedThreadRef) => void;
  toggle: (
    ref: ScopedThreadRef,
    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request">,
  ) => void;
  /** Leaves any active surface for the resting Run details view, opening the panel. */
  showRunDetails: (ref: ScopedThreadRef) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

const RESTING_OPEN_THREAD_STATE: ThreadRightPanelState = { ...EMPTY_THREAD_STATE, isOpen: true };

const singletonSurface = (
  kind: Exclude<RightPanelKind, "file" | "preview" | "terminal" | "pull-request">,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "pull-requests":
      return { id: "pull-requests", kind };
    case "device":
      return { id: "device", kind };
  }
};

const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
  relativePath,
  revealLine,
  revealRequestId,
});

const attachmentSurface = (attachment: ChatFileAttachment): RightPanelSurface => ({
  id: `attachment:${attachment.id}`,
  kind: "file",
  relativePath: attachment.name,
  revealLine: null,
  revealRequestId: 0,
  attachment,
});

const terminalSurface = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});

export type PullRequestSurface = Extract<RightPanelSurface, { kind: "pull-request" }>;

export function pullRequestSurfaceId(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
}): PullRequestSurface["id"] {
  // The environment leads the id where there is one, so the same change request read from two
  // servers is two tabs rather than one tab that changes its mind about which server it is on.
  const scope =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `pull-request:${scope}${encodeURIComponent(target.projectId)}:${host}${encodeURIComponent(target.repository)}:${target.number}`;
}

export function pullRequestSurface(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
}): PullRequestSurface {
  return {
    id: pullRequestSurfaceId(target),
    kind: "pull-request",
    ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
    projectId: target.projectId,
    ...(typeof target.host === "string" ? { host: target.host.toLowerCase() } : {}),
    repository: target.repository,
    number: target.number,
    ...(typeof target.url === "string" ? { url: target.url } : {}),
  };
}

/**
 * A thread's panel state. A thread the user never touched has no record and follows
 * `restingOpen`; the pull-request list's panel has nothing to rest on and starts closed.
 */
function resolveThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  threadKey: string,
  restingOpen: boolean,
): ThreadRightPanelState {
  const record = byThreadKey[threadKey];
  if (record) return record;
  return restingOpen && panelRestsOnRunDetails(threadKey)
    ? RESTING_OPEN_THREAD_STATE
    : EMPTY_THREAD_STATE;
}

/**
 * Drops surfaces from a panel. When the active one goes, a panel that rests on Run details
 * returns to it and stays open; one without falls back to the nearest survivor and hides
 * once nothing is left.
 */
export function removeRightPanelSurfaces(
  current: ThreadRightPanelState,
  removedIds: ReadonlySet<string>,
  options: { restsOnRunDetails: boolean },
): ThreadRightPanelState {
  const surfaces = current.surfaces.filter((surface) => !removedIds.has(surface.id));
  if (surfaces.length === current.surfaces.length) return current;
  const activeRemoved = current.activeSurfaceId !== null && removedIds.has(current.activeSurfaceId);
  if (options.restsOnRunDetails) {
    return {
      ...current,
      surfaces,
      activeSurfaceId: activeRemoved ? null : current.activeSurfaceId,
    };
  }
  const activeIndex = current.surfaces.findIndex(
    (surface) => surface.id === current.activeSurfaceId,
  );
  const fallback = surfaces[Math.min(Math.max(activeIndex, 0), surfaces.length - 1)] ?? null;
  return {
    ...current,
    isOpen: surfaces.length > 0 && current.isOpen,
    surfaces,
    activeSurfaceId: activeRemoved ? (fallback?.id ?? null) : current.activeSurfaceId,
  };
}

const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  ...current,
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

const updateThread = (
  state: Pick<RightPanelStoreState, "byThreadKey" | "restingOpen">,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Record<string, ThreadRightPanelState> => {
  const { byThreadKey } = state;
  const current = resolveThreadRightPanelState(byThreadKey, threadKey, state.restingOpen);
  const next = updater(current);
  // A closed, empty panel needs no record: an untouched thread reads the same.
  if (
    !next.isOpen &&
    next.activeSurfaceId === null &&
    next.surfaces.length === 0 &&
    !next.dismissedDeviceSurfaceIds?.length
  ) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

// Every store action is a user choice unless it goes through `automaticUpdate`.
// Only `openProactive` and resource reconciliation are automatic, so a new
// action counts as a user choice by default.
const automaticUpdate = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Partial<RightPanelStoreState> => ({
  byThreadKey: updateThread(state, threadKey, updater),
});

const userAction = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
  closesView = false,
): Partial<RightPanelStoreState> => ({
  byThreadKey: updateThread(state, threadKey, (current) => {
    const next = updater(current);
    const removed = current.surfaces.filter(
      (surface) =>
        surface.kind === "device" &&
        surface.target &&
        !next.surfaces.some((entry) => entry.id === surface.id),
    );
    if (removed.length === 0) return next;
    return {
      ...next,
      dismissedDeviceSurfaceIds: [
        ...new Set([
          ...(next.dismissedDeviceSurfaceIds ?? []),
          ...removed.map((surface) => surface.id),
        ]),
      ],
    };
  }),
  userActionRevisionByThreadKey: {
    ...state.userActionRevisionByThreadKey,
    [threadKey]: (state.userActionRevisionByThreadKey[threadKey] ?? 0) + 1,
  },
  ...(closesView
    ? {
        closeRevisionByThreadKey: {
          ...state.closeRevisionByThreadKey,
          [threadKey]: (state.closeRevisionByThreadKey[threadKey] ?? 0) + 1,
        },
      }
    : {}),
});

const closeAction = (
  state: RightPanelStoreState,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Partial<RightPanelStoreState> => userAction(state, threadKey, updater, true);

/** A whole-panel choice on a thread becomes what untouched threads show. */
const rememberResting = (
  ref: ScopedThreadRef,
  restingOpen: boolean,
): Partial<RightPanelStoreState> =>
  panelRestsOnRunDetails(scopedThreadKey(ref)) ? { restingOpen } : {};

/** Workspace entry paths use '/', including on Windows; a trailing slash names the same folder. */
function normalizeFilePath(requestedPath: string): string {
  return /^[A-Za-z]:\/+$/.test(requestedPath)
    ? requestedPath
    : requestedPath.replace(/\/+$/, "") || requestedPath;
}

/** The workspace path a Files or per-file surface shows, if any. Attachments have none. */
export function surfaceFilePath(surface: RightPanelSurface): string | null {
  if (surface.kind === "files") return surface.relativePath ?? null;
  if (surface.kind === "file" && surface.attachment === undefined) return surface.relativePath;
  return null;
}

/**
 * Whether a tab's file has an edit still saving. Saves are tracked by `file:<path>`, the per-file
 * tab's id, so the Files tab answers for the file it shows.
 */
export function isFileSurfacePending(
  surface: RightPanelSurface,
  pendingSurfaceIds: ReadonlySet<string>,
): boolean {
  if (surface.kind === "files") {
    return (
      surface.relativePath !== undefined && pendingSurfaceIds.has(`file:${surface.relativePath}`)
    );
  }
  return pendingSurfaceIds.has(surface.id);
}

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

/**
 * Before v15 every opened file was its own tab and opening one dropped the Files tab. Those tabs
 * become the one Files tab, at the first one's place, showing the active (or the last) of them.
 */
function foldFileTabsIntoFilesTab(
  surfaces: RightPanelSurface[],
  activeSurfaceId: string | null,
): { surfaces: RightPanelSurface[]; activeSurfaceId: string | null } {
  const isWorkspaceFile = (
    surface: RightPanelSurface,
  ): surface is Extract<RightPanelSurface, { kind: "file" }> =>
    surface.kind === "file" && surface.attachment === undefined;
  const fileTabs = surfaces.filter(isWorkspaceFile);
  if (fileTabs.length === 0) return { surfaces, activeSurfaceId };
  const shown = fileTabs.find((surface) => surface.id === activeSurfaceId) ?? fileTabs.at(-1)!;
  const existing = surfaces.find((surface) => surface.kind === "files");
  const files: RightPanelSurface = {
    id: "files",
    kind: "files",
    relativePath: shown.relativePath,
    revealLine: shown.revealLine,
    revealRequestId: shown.revealRequestId,
  };
  const anchor = existing ?? fileTabs[0]!;
  return {
    surfaces: surfaces.flatMap((surface) =>
      surface === anchor
        ? [files]
        : isWorkspaceFile(surface) || surface === existing
          ? []
          : [surface],
    ),
    activeSurfaceId: fileTabs.some((surface) => surface.id === activeSurfaceId)
      ? "files"
      : activeSurfaceId,
  };
}

export function migratePersistedRightPanelState(
  persistedState: unknown,
  version = 0,
): {
  byThreadKey: Record<string, ThreadRightPanelState>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {} };
  }
  const byThreadKey =
    "byThreadKey" in persistedState &&
    persistedState.byThreadKey &&
    typeof persistedState.byThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(persistedState.byThreadKey as Record<string, ThreadRightPanelState>)
            .filter(([threadKey]) => !isPullRequestsPanelKey(threadKey))
            .map(([threadKey, threadState]) => {
              const validThreadState =
                threadState && typeof threadState === "object" ? threadState : null;
              const migratedSurfaces = Array.isArray(validThreadState?.surfaces)
                ? validThreadState.surfaces.flatMap<RightPanelSurface>((surface) => {
                    // Dropped surface kinds: plans now render inline in the
                    // transcript (v9), and Overview became the resting Run
                    // details view (v14).
                    const droppedKind = (surface as { kind?: string }).kind;
                    if (droppedKind === "plan" || droppedKind === "agents") return [];
                    if (surface.kind === "files") {
                      if (typeof surface.relativePath !== "string") {
                        return [{ id: "files", kind: "files" }];
                      }
                      return [
                        {
                          id: "files",
                          kind: "files",
                          relativePath: surface.relativePath,
                          revealLine:
                            typeof surface.revealLine === "number" &&
                            Number.isFinite(surface.revealLine)
                              ? Math.max(1, Math.trunc(surface.revealLine))
                              : null,
                          revealRequestId:
                            typeof surface.revealRequestId === "number" &&
                            Number.isSafeInteger(surface.revealRequestId) &&
                            surface.revealRequestId >= 0
                              ? surface.revealRequestId
                              : 0,
                        },
                      ];
                    }
                    if (surface.kind === "file") {
                      const revealLine =
                        typeof surface.revealLine === "number" &&
                        Number.isFinite(surface.revealLine)
                          ? Math.max(1, Math.trunc(surface.revealLine))
                          : null;
                      const revealRequestId =
                        typeof surface.revealRequestId === "number" &&
                        Number.isSafeInteger(surface.revealRequestId) &&
                        surface.revealRequestId >= 0
                          ? surface.revealRequestId
                          : 0;
                      return [{ ...surface, revealLine, revealRequestId }];
                    }
                    if (surface.kind === "pull-request") {
                      if (
                        typeof surface.projectId !== "string" ||
                        typeof surface.repository !== "string" ||
                        typeof surface.number !== "number" ||
                        !Number.isSafeInteger(surface.number) ||
                        surface.number < 1
                      ) {
                        return [];
                      }
                      const { environmentId, ...rest } = surface;
                      // Anything else stored under that name is not an environment.
                      return [
                        pullRequestSurface({
                          ...rest,
                          ...(typeof environmentId === "string" ? { environmentId } : {}),
                        }),
                      ];
                    }
                    if (surface.kind !== "terminal") return [surface];
                    if (
                      !("resourceId" in surface) ||
                      typeof surface.resourceId !== "string" ||
                      surface.id !== `terminal:${surface.resourceId}`
                    ) {
                      return [];
                    }
                    const terminalIds =
                      "terminalIds" in surface && Array.isArray(surface.terminalIds)
                        ? [
                            ...new Set(
                              surface.terminalIds.filter(
                                (terminalId): terminalId is string =>
                                  typeof terminalId === "string",
                              ),
                            ),
                          ]
                        : [surface.resourceId];
                    const activeTerminalId =
                      "activeTerminalId" in surface &&
                      typeof surface.activeTerminalId === "string" &&
                      terminalIds.includes(surface.activeTerminalId)
                        ? surface.activeTerminalId
                        : (terminalIds[0] ?? surface.resourceId);
                    return [
                      {
                        ...surface,
                        terminalIds: terminalIds.length > 0 ? terminalIds : [surface.resourceId],
                        activeTerminalId,
                      },
                    ];
                  })
                : [];
              const rawActiveSurfaceId = validThreadState?.activeSurfaceId;
              const validActiveSurfaceId = migratedSurfaces.some(
                (surface) => surface.id === rawActiveSurfaceId,
              )
                ? (rawActiveSurfaceId ?? null)
                : rawActiveSurfaceId === "pull-request"
                  ? (migratedSurfaces.find((surface) => surface.kind === "pull-request")?.id ??
                    null)
                  : null;
              const { surfaces, activeSurfaceId: persistedActiveSurfaceId } =
                version < 15
                  ? foldFileTabsIntoFilesTab(migratedSurfaces, validActiveSurfaceId)
                  : { surfaces: migratedSurfaces, activeSurfaceId: validActiveSurfaceId };
              // An open thread panel with no active surface rests on Run
              // details, so a dropped surface (plan, Overview) leaves it there.
              const isOpen =
                typeof validThreadState?.isOpen === "boolean"
                  ? validThreadState.isOpen
                  : persistedActiveSurfaceId !== null;
              const activeSurfaceId = persistedActiveSurfaceId;
              return [
                threadKey,
                {
                  isOpen,
                  surfaces,
                  activeSurfaceId,
                  ...(Array.isArray(validThreadState?.dismissedDeviceSurfaceIds)
                    ? {
                        dismissedDeviceSurfaceIds:
                          validThreadState.dismissedDeviceSurfaceIds.filter(
                            (id): id is string => typeof id === "string",
                          ),
                      }
                    : {}),
                  ...(validThreadState?.maximized === true ? { maximized: true as const } : {}),
                },
              ];
            }),
        )
      : {};
  return { byThreadKey };
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      restingOpen: true,
      userActionRevisionByThreadKey: {},
      closeRevisionByThreadKey: {},
      getUserActionRevision: (ref) =>
        get().userActionRevisionByThreadKey[scopedThreadKey(ref)] ?? 0,
      openProactive: (ref, surface, expectedUserActionRevision) => {
        let opened = false;
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            (state.userActionRevisionByThreadKey[threadKey] ?? 0) !== expectedUserActionRevision
          ) {
            return state;
          }
          // A linked PR takes priority over a completed-turn diff. Manual actions
          // always apply, and later user choices reject both proactive requests.
          if (
            surface.kind === "diff" &&
            (selectActiveRightPanel(state.byThreadKey, ref) === "pull-request" ||
              selectActiveRightPanel(state.byThreadKey, ref) === "pull-requests")
          ) {
            return state;
          }
          opened = true;
          return automaticUpdate(state, threadKey, (current) => upsertSurface(current, surface));
        });
        return opened;
      },
      open: (ref, kind) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      openDevice: (ref, target, automatic = false) =>
        set((state) =>
          (automatic ? automaticUpdate : userAction)(state, scopedThreadKey(ref), (current) => {
            const id =
              `device:${encodeURIComponent(target.hostId)}:${encodeURIComponent(target.deviceId)}` as const;
            if (automatic && current.dismissedDeviceSurfaceIds?.includes(id)) return current;
            const surface: RightPanelSurface = { id, kind: "device", target };
            const existing = current.surfaces.find((entry) => entry.id === id);
            const surfaces = existing
              ? current.surfaces.filter((entry) => entry.id !== "device")
              : current.surfaces.map((entry) => (entry.id === "device" ? surface : entry));
            return upsertSurface(
              {
                ...current,
                surfaces,
                dismissedDeviceSurfaceIds: (current.dismissedDeviceSurfaceIds ?? []).filter(
                  (entry) => entry !== id,
                ),
              },
              existing ?? surface,
            );
          }),
        ),
      renameDevice: (ref, surfaceId, title) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId && surface.kind === "device"
                ? { ...surface, title: title.trim() || surface.target?.name || "Device" }
                : surface,
            ),
          })),
        ),
      openBrowser: (ref, tabId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = browserSurface(tabId);
            const withoutPlaceholder = tabId
              ? current.surfaces.filter((entry) => entry.id !== "browser:new")
              : current.surfaces;
            return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
          }),
        ),
      openPullRequest: (ref, target) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const surface = pullRequestSurface(target);
            const next = upsertSurface(current, surface);
            return target.url
              ? {
                  ...next,
                  surfaces: next.surfaces.map((entry) =>
                    entry.id === surface.id ? surface : entry,
                  ),
                }
              : next;
          }),
        ),
      openFile: (ref, requestedPath, line) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const relativePath = normalizeFilePath(requestedPath);
            const kept = current.surfaces.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "file" }> =>
                surface.id === `file:${relativePath}` && surface.kind === "file",
            );
            // A file kept as its own tab is shown there, so it is never open twice.
            if (kept) {
              const surface = fileSurface(
                relativePath,
                normalizeRevealLine(line),
                kept.revealRequestId + 1,
              );
              return {
                ...current,
                isOpen: true,
                activeSurfaceId: surface.id,
                surfaces: current.surfaces.map((entry) =>
                  entry.id === surface.id ? surface : entry,
                ),
              };
            }
            const existing = current.surfaces.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "files" }> =>
                surface.kind === "files",
            );
            const files: RightPanelSurface = {
              id: "files",
              kind: "files",
              relativePath,
              revealLine: normalizeRevealLine(line),
              revealRequestId: (existing?.revealRequestId ?? 0) + 1,
            };
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: files.id,
              surfaces: existing
                ? current.surfaces.map((entry) => (entry.id === files.id ? files : entry))
                : [...current.surfaces, files],
            };
          }),
        ),
      keepFileAsTab: (ref, requestedPath) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const relativePath = normalizeFilePath(requestedPath);
            const surfaceId = `file:${relativePath}` as const;
            const existing = current.surfaces.find((surface) => surface.id === surfaceId);
            // The Files tab lets go of the file, so it is open in one place and the Files tab
            // goes back to its explorer.
            const surfaces = current.surfaces.flatMap<RightPanelSurface>((surface) =>
              surface.kind === "files" && surface.relativePath === relativePath
                ? [{ id: "files", kind: "files" }]
                : [surface],
            );
            const filesIndex = surfaces.findIndex((surface) => surface.kind === "files");
            const kept = fileSurface(relativePath, null, 0);
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: surfaceId,
              surfaces: existing
                ? surfaces
                : filesIndex < 0
                  ? [...surfaces, kept]
                  : [...surfaces.slice(0, filesIndex + 1), kept, ...surfaces.slice(filesIndex + 1)],
            };
          }),
        ),
      openAttachment: (ref, attachment) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            upsertSurface(current, attachmentSurface(attachment)),
          ),
        ),
      openTerminal: (ref, terminalId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            upsertSurface(current, terminalSurface(terminalId)),
          ),
        ),
      splitTerminal: (ref, surfaceId, terminalId, direction = "horizontal") =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            isOpen: true,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) => {
              if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
              const { splitDirection: _splitDirection, ...baseSurface } = surface;
              return {
                ...baseSurface,
                terminalIds: surface.terminalIds.includes(terminalId)
                  ? surface.terminalIds
                  : [...surface.terminalIds, terminalId],
                activeTerminalId: terminalId,
                ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
              };
            }),
          })),
        ),
      activateTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => ({
            ...current,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId &&
              surface.kind === "terminal" &&
              surface.terminalIds.includes(terminalId)
                ? { ...surface, activeTerminalId: terminalId }
                : surface,
            ),
          })),
        ),
      closeTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const surface = current.surfaces.find(
              (entry) => entry.id === surfaceId && entry.kind === "terminal",
            );
            if (!surface || surface.kind !== "terminal") return current;
            const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
            if (terminalIds.length === 0) {
              return removeRightPanelSurfaces(current, new Set([surfaceId]), {
                restsOnRunDetails: panelRestsOnRunDetails(scopedThreadKey(ref)),
              });
            }
            return {
              ...current,
              surfaces: current.surfaces.map((entry) =>
                entry.id === surfaceId && entry.kind === "terminal"
                  ? {
                      ...entry,
                      terminalIds,
                      activeTerminalId:
                        entry.activeTerminalId === terminalId
                          ? (terminalIds.at(-1) ?? terminalIds[0]!)
                          : entry.activeTerminalId,
                    }
                  : entry,
              ),
            };
          }),
        ),
      activateSurface: (ref, surfaceId) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            current.surfaces.some((surface) => surface.id === surfaceId)
              ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
              : current,
          ),
        ),
      closeSurface: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) =>
            removeRightPanelSurfaces(current, new Set([surfaceId]), {
              restsOnRunDetails: panelRestsOnRunDetails(scopedThreadKey(ref)),
            }),
          ),
        ),
      closeOtherSurfaces: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const surface = current.surfaces.find((entry) => entry.id === surfaceId);
            if (!surface || current.surfaces.length === 1) return current;
            return {
              ...current,
              isOpen: true,
              surfaces: [surface],
              activeSurfaceId: surface.id,
            };
          }),
        ),
      closeSurfacesToRight: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0 || index === current.surfaces.length - 1) return current;
            const surfaces = current.surfaces.slice(0, index + 1);
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
            };
          }),
        ),
      closeAllSurfaces: (ref) =>
        set((state) =>
          closeAction(state, scopedThreadKey(ref), (current) =>
            current.surfaces.length === 0
              ? current
              : {
                  ...current,
                  // A thread keeps showing Run details; the pull-request list's panel hides.
                  isOpen: panelRestsOnRunDetails(scopedThreadKey(ref)) && current.isOpen,
                  surfaces: [],
                  activeSurfaceId: null,
                },
          ),
        ),
      // Reordering is not a choice about what the panel shows, so it leaves the
      // user-action revision alone and proactive opens still apply.
      moveSurface: (ref, surfaceId, toIndex) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            const fromIndex = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (fromIndex < 0) return current;
            // A negative splice index counts from the end, so clamp rather than wrap.
            const targetIndex = Math.min(Math.max(toIndex, 0), current.surfaces.length - 1);
            if (fromIndex === targetIndex) return current;
            const surfaces = [...current.surfaces];
            surfaces.splice(targetIndex, 0, ...surfaces.splice(fromIndex, 1));
            return { ...current, surfaces };
          }),
        ),
      reconcileBrowserSurfaces: (ref, tabIds) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
            // Filtered in place so browser tabs keep the order the user dragged them into.
            const kept = current.surfaces.filter(
              (surface) =>
                surface.kind !== "preview" ||
                (surface.id !== "browser:new" && validIds.has(surface.id)),
            );
            const knownIds = new Set(kept.map((surface) => surface.id));
            const added = tabIds
              .filter((tabId) => !knownIds.has(`browser:${tabId}`))
              .map((tabId) => browserSurface(tabId));
            const surfaces = [...kept, ...added];
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (panelRestsOnRunDetails(scopedThreadKey(ref))) {
              return {
                ...current,
                surfaces,
                activeSurfaceId: activeStillExists ? current.activeSurfaceId : null,
              };
            }
            const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
            // A closed session tab was the last surface: hide the panel rather than leave it on
            // the empty picker, as a user close would. A dropped `browser:new` placeholder does not count.
            const closedLastSessionTab =
              surfaces.length === 0 &&
              current.surfaces.some((surface) => surface.kind === "preview" && surface.resourceId);
            return {
              ...current,
              isOpen: closedLastSessionTab ? false : current.isOpen,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (fallbackBrowser?.id ?? surfaces[0]?.id ?? null),
            };
          }),
        ),
      reconcileFileSurfaces: (ref, workspaceAvailable) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            if (workspaceAvailable) return current;
            const surfaces = current.surfaces.filter(
              (surface) =>
                surface.kind !== "files" &&
                (surface.kind !== "file" || surface.attachment !== undefined),
            );
            if (surfaces.length === current.surfaces.length) return current;
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (panelRestsOnRunDetails(scopedThreadKey(ref))) {
              return {
                ...current,
                surfaces,
                activeSurfaceId: activeStillExists ? current.activeSurfaceId : null,
              };
            }
            return {
              ...current,
              isOpen: surfaces.length > 0 ? current.isOpen : false,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (surfaces.at(-1)?.id ?? null),
            };
          }),
        ),
      // Always writes a record: a narrow-window sheet ignores `restingOpen` and reads only it.
      show: (ref) =>
        set((state) => ({
          ...userAction(state, scopedThreadKey(ref), (current) => ({ ...current, isOpen: true })),
          ...rememberResting(ref, true),
        })),
      close: (ref, options) =>
        set((state) => ({
          ...userAction(state, scopedThreadKey(ref), (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
          ...(options?.remember === false ? {} : rememberResting(ref, false)),
        })),
      // Layout only: it changes no surface, so proactive panels still apply.
      setMaximized: (ref, maximized) =>
        set((state) =>
          automaticUpdate(state, scopedThreadKey(ref), (current) => {
            if ((current.maximized ?? false) === maximized) return current;
            const { maximized: _maximized, ...rest } = current;
            return maximized ? { ...rest, maximized: true } : rest;
          }),
        ),
      toggleVisibility: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const isOpen = !resolveThreadRightPanelState(
            state.byThreadKey,
            threadKey,
            state.restingOpen,
          ).isOpen;
          return {
            ...userAction(state, threadKey, (current) => ({ ...current, isOpen })),
            ...rememberResting(ref, isOpen),
          };
        }),
      toggle: (ref, kind) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) => {
            const active = current.surfaces.find(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (current.isOpen && active?.kind === kind) {
              // Toggling the shown surface off leaves it for Run details on a thread.
              return panelRestsOnRunDetails(scopedThreadKey(ref))
                ? { ...current, activeSurfaceId: null }
                : { ...current, isOpen: false };
            }
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      showRunDetails: (ref) =>
        set((state) =>
          userAction(state, scopedThreadKey(ref), (current) =>
            current.isOpen && current.activeSurfaceId === null
              ? current
              : { ...current, isOpen: true, activeSurfaceId: null },
          ),
        ),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.userActionRevisionByThreadKey) &&
            !(threadKey in state.closeRevisionByThreadKey)
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...rest } = state.byThreadKey;
          const { [threadKey]: _revision, ...userActionRevisionByThreadKey } =
            state.userActionRevisionByThreadKey;
          const { [threadKey]: _closeRevision, ...closeRevisionByThreadKey } =
            state.closeRevisionByThreadKey;
          return { byThreadKey: rest, userActionRevisionByThreadKey, closeRevisionByThreadKey };
        }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      version: RIGHT_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        restingOpen: state.restingOpen,
        byThreadKey: Object.fromEntries(
          Object.entries(state.byThreadKey).filter(
            ([threadKey]) => !isPullRequestsPanelKey(threadKey),
          ),
        ),
      }),
      migrate: migratePersistedRightPanelState,
    },
  ),
);

useRightPanelStore.subscribe((next, previous) => {
  if (next.closeRevisionByThreadKey === previous.closeRevisionByThreadKey) return;
  for (const [threadKey, revision] of Object.entries(next.closeRevisionByThreadKey)) {
    if (revision === previous.closeRevisionByThreadKey[threadKey]) continue;
    const threadRef = parseScopedThreadKey(threadKey);
    if (!threadRef) continue;
    const before = previous.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
    const after = next.byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
    const removed = before.surfaces.filter(
      (surface) => !after.surfaces.some((entry) => entry.id === surface.id),
    );
    const closedInOrder = [
      ...removed.filter((surface) => surface.id !== before.activeSurfaceId),
      ...removed.filter((surface) => surface.id === before.activeSurfaceId),
    ];
    for (const surface of closedInOrder) {
      if (
        surface.kind === "terminal" ||
        (surface.kind === "preview" && surface.resourceId !== null)
      )
        continue;
      useClosedViewStore.getState().remember({ kind: "panel-tab", threadRef, surface });
    }
  }
});

/**
 * Pass the store's `restingOpen` for a docked panel. Leave it out to read only what the thread
 * recorded, as a narrow-window sheet does so it never covers the chat unasked.
 */
export function selectThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
  restingOpen = false,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return resolveThreadRightPanelState(byThreadKey, scopedThreadKey(ref), restingOpen);
}

export function selectActiveRightPanel(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return selectSelectedRightPanelSurface(byThreadKey, ref);
}

/** The selected surface even while the panel is hidden, so a layout control can restore it. */
export function selectSelectedRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}
