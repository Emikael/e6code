import { Debouncer } from "@tanstack/react-pacer";
import type { PullRequestMergeMethod } from "@e6tools/contracts";
import { create } from "zustand";
import { normalizeProjectPathForComparison } from "./lib/projectPaths";

export const PERSISTED_STATE_KEY = "e6code:ui-state:v1";
// Version 1 stored card visibility, not folder expansion.
const THREAD_CHANGED_FILES_EXPANSION_VERSION = 2;
const LEGACY_PERSISTED_STATE_KEYS = [
  "e6code:renderer-state:v8",
  "e6code:renderer-state:v7",
  "e6code:renderer-state:v6",
  "e6code:renderer-state:v5",
  "e6code:renderer-state:v4",
  "e6code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

export interface PersistedUiState {
  projectExpandedById?: Record<string, boolean>;
  projectOrder?: string[];
  threadLastVisitedAtById?: Record<string, string>;
  collapsedProjectCwds?: string[];
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  defaultAdvertisedEndpointKey?: string | null;
  sidebarProjectScopeKey?: string | null;
  threadChangedFilesExpansionVersion?: number;
  threadChangedFilesExpandedById?: Record<string, Record<string, boolean>>;
  pullRequestMergeMethod?: string;
  runDetailsSectionOpen?: Record<string, boolean>;
  focusMode?: boolean;
  recentFilesByThreadKey?: Record<string, RecentFile[]>;
  filesFilterByThreadKey?: Record<string, FilesFilterChoice>;
}

/** A file opened in a thread's Files tab, with the line it was left at. */
export interface RecentFile {
  readonly path: string;
  readonly line: number | null;
}

export type FilesFilterChoice = "all" | "changed";

/** Files tab state kept per thread on this device (F18). */
export interface UiFilesState {
  /** The last files opened in each thread, newest first, at most RECENT_FILES_LIMIT. */
  recentFilesByThreadKey: Record<string, RecentFile[]>;
  /** The explorer filter each thread was left on; absent until the reader picks one. */
  filesFilterByThreadKey: Record<string, FilesFilterChoice>;
}

export const RECENT_FILES_LIMIT = 5;
/** Threads whose Files tab state is kept; the oldest are forgotten first. */
const FILES_STATE_THREAD_LIMIT = 200;

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
  // Logical project key the sidebar list is scoped to, or null for "all
  // projects". Lives here so routes that unmount the sidebar (Settings)
  // cannot reset the filter.
  sidebarProjectScopeKey: string | null;
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>;
}

export interface UiEndpointState {
  defaultAdvertisedEndpointKey: string | null;
}

export interface UiPullRequestState {
  pullRequestMergeMethod: PullRequestMergeMethod;
}

/** The collapsible sections of Run details, in the order they render. */
export const RUN_DETAILS_SECTIONS = ["plan", "changes", "subagents", "usage"] as const;
export type RunDetailsSectionId = (typeof RUN_DETAILS_SECTIONS)[number];

export interface UiRunDetailsState {
  /** Sections the user opened or closed on this device; absent ones use their default. */
  runDetailsSectionOpen: Partial<Record<RunDetailsSectionId, boolean>>;
}

/**
 * Focus mode (F6): one thread, no periphery. A render-time override: while on,
 * the sidebar, right panel and terminal drawer render closed without writing
 * their own state, so leaving focus shows them exactly as they were.
 */
export interface UiFocusState {
  /** Persisted, so a reload stays in focus. */
  focusMode: boolean;
  /**
   * The right panel was opened during focus (Mod+D, Review diff), so it shows
   * until closed. Not persisted: a reload in focus starts with it closed.
   */
  focusPanelPeek: boolean;
}

export interface UiState
  extends
    UiProjectState,
    UiThreadState,
    UiEndpointState,
    UiPullRequestState,
    UiRunDetailsState,
    UiFocusState,
    UiFilesState {}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  sidebarProjectScopeKey: null,
  threadLastVisitedAtById: {},
  threadChangedFilesExpandedById: {},
  defaultAdvertisedEndpointKey: null,
  pullRequestMergeMethod: "merge",
  runDetailsSectionOpen: {},
  focusMode: false,
  focusPanelPeek: false,
  recentFilesByThreadKey: {},
  filesFilterByThreadKey: {},
};

const LEGACY_PROJECT_CWD_PREFERENCE_PREFIX = "legacy-project-cwd:";
const LEGACY_PROJECT_EXPANSION_DEFAULT_KEY = "legacy-project-expansion-default";
let legacyKeysCleanedUp = false;

export function legacyProjectCwdPreferenceKey(cwd: string): string {
  return `${LEGACY_PROJECT_CWD_PREFERENCE_PREFIX}${normalizeProjectPathForComparison(cwd)}`;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  ];
}

function sanitizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => entry[0].length > 0 && typeof entry[1] === "boolean",
    ),
  );
}

function sanitizeOptionalKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeTimestampRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 &&
        typeof entry[1] === "string" &&
        entry[1].length > 0 &&
        Number.isFinite(Date.parse(entry[1])),
    ),
  );
}

function sanitizeRunDetailsSectionOpen(
  value: unknown,
): Partial<Record<RunDetailsSectionId, boolean>> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const next: Partial<Record<RunDetailsSectionId, boolean>> = {};
  for (const section of RUN_DETAILS_SECTIONS) {
    const open = record[section];
    if (typeof open === "boolean") next[section] = open;
  }
  return next;
}

function sanitizeRecentFiles(value: unknown): Record<string, RecentFile[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([threadKey, files]) => {
      if (!Array.isArray(files)) return [];
      const valid = files
        .filter(
          (file): file is RecentFile =>
            !!file &&
            typeof file === "object" &&
            typeof file.path === "string" &&
            file.path.length > 0 &&
            (file.line === null || (Number.isSafeInteger(file.line) && file.line > 0)),
        )
        .slice(0, RECENT_FILES_LIMIT)
        .map((file) => ({ path: file.path, line: file.line }));
      return valid.length > 0 ? [[threadKey, valid]] : [];
    }),
  );
}

function sanitizeFilesFilters(value: unknown): Record<string, FilesFilterChoice> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, FilesFilterChoice] => entry[1] === "all" || entry[1] === "changed",
    ),
  );
}

/** Keeps the newest `limit` keys of a record whose keys are inserted oldest first. */
function keepNewestKeys<T>(record: Record<string, T>, limit: number): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.length <= limit) return record;
  return Object.fromEntries(keys.slice(keys.length - limit).map((key) => [key, record[key]!]));
}

/**
 * A file was opened (line null) or left at a line in a thread's Files tab. It moves to the front
 * of that thread's recent files; a known line is kept when the file is opened again without one.
 */
export function recordRecentFile(
  state: UiState,
  threadKey: string,
  path: string,
  line: number | null,
): UiState {
  const current = state.recentFilesByThreadKey[threadKey] ?? [];
  const previous = current.find((file) => file.path === path);
  const nextLine = line ?? (previous ? previous.line : null);
  if (current[0]?.path === path && current[0].line === nextLine) return state;
  const files = [{ path, line: nextLine }, ...current.filter((file) => file.path !== path)].slice(
    0,
    RECENT_FILES_LIMIT,
  );
  const { [threadKey]: _previous, ...rest } = state.recentFilesByThreadKey;
  return {
    ...state,
    recentFilesByThreadKey: keepNewestKeys(
      { ...rest, [threadKey]: files },
      FILES_STATE_THREAD_LIMIT,
    ),
  };
}

export function setFilesFilter(
  state: UiState,
  threadKey: string,
  filter: FilesFilterChoice,
): UiState {
  if (state.filesFilterByThreadKey[threadKey] === filter) return state;
  const { [threadKey]: _previous, ...rest } = state.filesFilterByThreadKey;
  return {
    ...state,
    filesFilterByThreadKey: keepNewestKeys(
      { ...rest, [threadKey]: filter },
      FILES_STATE_THREAD_LIMIT,
    ),
  };
}

function isPullRequestMergeMethod(value: unknown): value is PullRequestMergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

export function parsePersistedState(parsed: PersistedUiState): UiState {
  const projectExpandedById =
    parsed.projectExpandedById === undefined
      ? (() => {
          const migrated: Record<string, boolean> = {};
          const collapsedProjectCwds = sanitizeStringArray(parsed.collapsedProjectCwds);
          const expandedProjectCwds = sanitizeStringArray(parsed.expandedProjectCwds);
          for (const cwd of collapsedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = false;
          }
          for (const cwd of expandedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = true;
          }
          if (!Array.isArray(parsed.collapsedProjectCwds) && expandedProjectCwds.length > 0) {
            migrated[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] = false;
          }
          return migrated;
        })()
      : sanitizeBooleanRecord(parsed.projectExpandedById);
  const projectOrder =
    parsed.projectOrder === undefined
      ? sanitizeStringArray(parsed.projectOrderCwds).map(legacyProjectCwdPreferenceKey)
      : sanitizeStringArray(parsed.projectOrder);

  return {
    projectExpandedById,
    projectOrder,
    threadLastVisitedAtById: sanitizeTimestampRecord(parsed.threadLastVisitedAtById),
    threadChangedFilesExpandedById:
      parsed.threadChangedFilesExpansionVersion === THREAD_CHANGED_FILES_EXPANSION_VERSION
        ? sanitizePersistedThreadChangedFilesExpanded(parsed.threadChangedFilesExpandedById)
        : {},
    defaultAdvertisedEndpointKey: sanitizeOptionalKey(parsed.defaultAdvertisedEndpointKey),
    sidebarProjectScopeKey: sanitizeOptionalKey(parsed.sidebarProjectScopeKey),
    pullRequestMergeMethod: isPullRequestMergeMethod(parsed.pullRequestMergeMethod)
      ? parsed.pullRequestMergeMethod
      : initialState.pullRequestMergeMethod,
    runDetailsSectionOpen: sanitizeRunDetailsSectionOpen(parsed.runDetailsSectionOpen),
    focusMode: parsed.focusMode === true,
    focusPanelPeek: false,
    recentFilesByThreadKey: sanitizeRecentFiles(parsed.recentFilesByThreadKey),
    filesFilterByThreadKey: sanitizeFilesFilters(parsed.filesFilterByThreadKey),
  };
}

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        return parsePersistedState(JSON.parse(legacyRaw) as PersistedUiState);
      }
      return initialState;
    }
    return parsePersistedState(JSON.parse(raw) as PersistedUiState);
  } catch {
    return initialState;
  }
}

function sanitizePersistedThreadChangedFilesExpanded(
  value: PersistedUiState["threadChangedFilesExpandedById"],
): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, Record<string, boolean>> = {};
  for (const [threadId, turns] of Object.entries(value)) {
    if (!threadId || !turns || typeof turns !== "object") {
      continue;
    }

    const nextTurns: Record<string, boolean> = {};
    for (const [turnId, expanded] of Object.entries(turns)) {
      if (turnId && typeof expanded === "boolean") {
        nextTurns[turnId] = expanded;
      }
    }

    if (Object.keys(nextTurns).length > 0) {
      nextState[threadId] = nextTurns;
    }
  }

  return nextState;
}

export function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const projectExpandedById = Object.fromEntries(
      Object.entries(state.projectExpandedById).filter(
        ([key]) => key !== LEGACY_PROJECT_EXPANSION_DEFAULT_KEY,
      ),
    );
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        projectExpandedById,
        projectOrder: state.projectOrder,
        threadLastVisitedAtById: state.threadLastVisitedAtById,
        defaultAdvertisedEndpointKey: state.defaultAdvertisedEndpointKey,
        sidebarProjectScopeKey: state.sidebarProjectScopeKey,
        threadChangedFilesExpansionVersion: THREAD_CHANGED_FILES_EXPANSION_VERSION,
        threadChangedFilesExpandedById: state.threadChangedFilesExpandedById,
        pullRequestMergeMethod: state.pullRequestMergeMethod,
        runDetailsSectionOpen: state.runDetailsSectionOpen,
        focusMode: state.focusMode,
        recentFilesByThreadKey: state.recentFilesByThreadKey,
        filesFilterByThreadKey: state.filesFilterByThreadKey,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

export function markThreadVisited(state: UiState, threadId: string, visitedAt: string): UiState {
  const visitedAtMs = Date.parse(visitedAt);
  if (!Number.isFinite(visitedAtMs)) {
    return state;
  }
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: visitedAt,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function setThreadChangedFilesExpanded(
  state: UiState,
  threadId: string,
  turnId: string,
  expanded: boolean,
): UiState {
  const currentThreadState = state.threadChangedFilesExpandedById[threadId] ?? {};
  if (currentThreadState[turnId] === expanded) {
    return state;
  }

  return {
    ...state,
    threadChangedFilesExpandedById: {
      ...state.threadChangedFilesExpandedById,
      [threadId]: {
        ...currentThreadState,
        [turnId]: expanded,
      },
    },
  };
}

export function setDefaultAdvertisedEndpointKey(state: UiState, key: string | null): UiState {
  const nextKey = key && key.length > 0 ? key : null;
  if (state.defaultAdvertisedEndpointKey === nextKey) {
    return state;
  }
  return {
    ...state,
    defaultAdvertisedEndpointKey: nextKey,
  };
}

export function setSidebarProjectScopeKey(state: UiState, projectKey: string | null): UiState {
  const nextKey = sanitizeOptionalKey(projectKey);
  if (state.sidebarProjectScopeKey === nextKey) {
    return state;
  }
  return {
    ...state,
    sidebarProjectScopeKey: nextKey,
  };
}

export function setRunDetailsSectionOpen(
  state: UiState,
  section: RunDetailsSectionId,
  open: boolean,
): UiState {
  if (state.runDetailsSectionOpen[section] === open) return state;
  return {
    ...state,
    runDetailsSectionOpen: { ...state.runDetailsSectionOpen, [section]: open },
  };
}

function setPullRequestMergeMethod(state: UiState, method: PullRequestMergeMethod): UiState {
  return state.pullRequestMergeMethod === method
    ? state
    : { ...state, pullRequestMergeMethod: method };
}

/** Entering or leaving focus starts with the right panel hidden again. */
export function setFocusMode(state: UiState, focusMode: boolean): UiState {
  if (state.focusMode === focusMode && !state.focusPanelPeek) return state;
  return { ...state, focusMode, focusPanelPeek: false };
}

export function setFocusPanelPeek(state: UiState, peek: boolean): UiState {
  if (!state.focusMode || state.focusPanelPeek === peek) return state;
  return { ...state, focusPanelPeek: peek };
}

export function resolveProjectExpanded(
  projectExpandedById: Readonly<Record<string, boolean>>,
  preferenceKeys: readonly string[],
): boolean {
  for (const key of preferenceKeys) {
    const expanded = projectExpandedById[key];
    if (expanded !== undefined) {
      return expanded;
    }
  }
  return projectExpandedById[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] ?? true;
}

export function setProjectExpanded(
  state: UiState,
  projectIds: string | readonly string[],
  expanded: boolean,
): UiState {
  const ids = typeof projectIds === "string" ? [projectIds] : projectIds;
  const nextEntries = ids.filter((projectId) => state.projectExpandedById[projectId] !== expanded);
  if (nextEntries.length === 0) {
    return state;
  }
  const projectExpandedById = { ...state.projectExpandedById };
  for (const projectId of nextEntries) {
    projectExpandedById[projectId] = expanded;
  }
  return {
    ...state,
    projectExpandedById,
  };
}

export function reorderProjects(
  state: UiState,
  currentProjectOrder: readonly string[],
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = currentProjectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...currentProjectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  markThreadVisited: (threadId: string, visitedAt: string) => void;
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  setThreadChangedFilesExpanded: (threadId: string, turnId: string, expanded: boolean) => void;
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
  setSidebarProjectScopeKey: (projectKey: string | null) => void;
  setPullRequestMergeMethod: (method: PullRequestMergeMethod) => void;
  setRunDetailsSectionOpen: (section: RunDetailsSectionId, open: boolean) => void;
  setFocusMode: (focusMode: boolean) => void;
  toggleFocusMode: () => void;
  setFocusPanelPeek: (peek: boolean) => void;
  setProjectExpanded: (projectIds: string | readonly string[], expanded: boolean) => void;
  recordRecentFile: (threadKey: string, path: string, line: number | null) => void;
  setFilesFilter: (threadKey: string, filter: FilesFilterChoice) => void;
  reorderProjects: (
    currentProjectOrder: readonly string[],
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  setThreadChangedFilesExpanded: (threadId, turnId, expanded) =>
    set((state) => setThreadChangedFilesExpanded(state, threadId, turnId, expanded)),
  setDefaultAdvertisedEndpointKey: (key) =>
    set((state) => setDefaultAdvertisedEndpointKey(state, key)),
  setSidebarProjectScopeKey: (projectKey) =>
    set((state) => setSidebarProjectScopeKey(state, projectKey)),
  setPullRequestMergeMethod: (method) => set((state) => setPullRequestMergeMethod(state, method)),
  setRunDetailsSectionOpen: (section, open) =>
    set((state) => setRunDetailsSectionOpen(state, section, open)),
  setFocusMode: (focusMode) => set((state) => setFocusMode(state, focusMode)),
  toggleFocusMode: () => set((state) => setFocusMode(state, !state.focusMode)),
  setFocusPanelPeek: (peek) => set((state) => setFocusPanelPeek(state, peek)),
  setProjectExpanded: (projectIds, expanded) =>
    set((state) => setProjectExpanded(state, projectIds, expanded)),
  recordRecentFile: (threadKey, path, line) =>
    set((state) => recordRecentFile(state, threadKey, path, line)),
  setFilesFilter: (threadKey, filter) => set((state) => setFilesFilter(state, threadKey, filter)),
  reorderProjects: (currentProjectOrder, draggedProjectIds, targetProjectIds) =>
    set((state) =>
      reorderProjects(state, currentProjectOrder, draggedProjectIds, targetProjectIds),
    ),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
