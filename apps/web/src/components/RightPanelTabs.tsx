import { pullRequestHostOf, type SourceControlProviderKind } from "@e6tools/contracts";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/shell";
import { useProjects, useServerConfigs, useThreadShells } from "~/state/entities";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@e6tools/shared/threadPullRequests";
import type {
  ContextMenuItem,
  EnvironmentId,
  PreviewSessionSnapshot,
  ProjectId,
  PullRequestState,
  ResolvedKeybindingsConfig,
} from "@e6tools/contracts";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ListTree,
  Smartphone,
  ChevronDown,
  FileDiff,
  Files,
  Globe2,
  Plus,
  TerminalSquare,
  X,
} from "lucide-react";
import { Volume2, VolumeOff } from "lucide";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { onRightPanelNewMenuRequest } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import {
  effectiveShortcutsForCommand,
  resolveShortcutCommand,
  type ShortcutMatchContext,
} from "~/keybindings";
import { readLocalApi } from "~/localApi";
import { useStableCallback } from "~/hooks/useStableCallback";
import { Button } from "~/components/ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { AndroidIcon, AppleIcon } from "~/components/Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useBrowserDefaults } from "~/browser/browserDefaults";
import { ScrollArea } from "~/components/ui/scroll-area";
import { faviconUrlForOrigin } from "@e6tools/shared/favicon";
import { useTheme } from "~/hooks/useTheme";
import { useDeviceState } from "~/state/device";
import {
  newestPullRequestSummary,
  pullRequestEnvironment,
  useSharedPullRequestSummary,
} from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { FaviconImage } from "./preview/PreviewFaviconIcon";
import { previewBridge } from "./preview/previewBridge";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";
import {
  closeTabKeyShortcuts,
  overflowMenuLabel,
  runningTerminalCount,
  surfaceTitle,
  surfaceTitleParts,
  tabsOutOfView,
  type SurfaceTitleParts,
  type TabExtent,
} from "./rightPanelTabLabels";
import { surfaceShortcutKey } from "~/lib/surfaceShortcutKey";

export interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  open?: boolean;
  keybindings: ResolvedKeybindingsConfig;
  getShortcutContext: () => ShortcutMatchContext;
  widthStorageKey?: string;
  defaultWidth?: number;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  environmentId: EnvironmentId | null;
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  /** Maps server-local session ids to desktop runtime ids; session ids cannot address desktop operations. */
  previewRuntimeTabId?: ((tabId: string) => string) | undefined;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onRenameDevice?: (surfaceId: string, title: string) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onMoveSurface?: (surfaceId: string, toIndex: number) => void;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: () => void;
  /** Keep separate from the DOM click handler so a MouseEvent cannot become a profile id. */
  onAddBrowserInProfile: (profileId: string) => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddPullRequests: () => void;
  onAddDevice: () => void;
  /**
   * Set on a thread, whose panel rests on Run details (the children) whenever no surface is
   * active. Without it, no active surface shows the surface launcher instead.
   */
  onShowRunDetails?: (() => void) | undefined;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  pullRequestsAvailable: boolean;
  deviceAvailable: boolean;
  /** Files changed in the working tree; counted on the Diff tab. */
  changedFileCount?: number;
  /** The thread's terminals with a running process; named on their tabs. */
  runningTerminalIds?: ReadonlyArray<string> | undefined;
  pullRequestStatusSeeds?: Readonly<Record<string, PullRequestTabStatusSeed>>;
  children: ReactNode;
}

export interface PullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

export type PullRequestTabStatusSeed = Pick<PullRequestTabStatus, "state" | "isDraft">;

export function shouldOpenDefaultBrowserProfileFromMenuClick(
  pointerType: string | undefined,
): boolean {
  return pointerType !== "touch";
}

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the E6 Code desktop app.",
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
  pullRequest: "This thread's branch has no pull request yet.",
  pullRequests: "No linked pull requests are available for this thread.",
  device: "Devices are only available from a thread.",
} as const;

// Closed keepMounted popups must stop blocking shortcuts once their exit transition ends.
const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  "dialog-popup",
  "alert-dialog-popup",
  "command-dialog-popup",
  "menu-popup",
  "select-popup",
  "popover-popup",
  "combobox-popup",
  "autocomplete-popup",
]
  .map((slot) => `[data-slot="${slot}"]:is([data-open],[data-ending-style])`)
  .join(",");

const SURFACE_UNAVAILABLE_HINTS = {
  browser: "Only available in the desktop app.",
  terminal: "Available when a project is open.",
  files: "Available when a project is open.",
  diff: "Available for Git repositories.",
  pullRequest: "No pull request on this branch yet.",
  pullRequests: "No linked pull requests available.",
  device: "Available from a thread.",
} as const;

type TabContextMenuAction =
  | "rename"
  | "copy-path"
  | "toggle-mute"
  | "move-left"
  | "move-right"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];

function tabScrollViewport(root: HTMLDivElement | null): HTMLDivElement | null {
  return root?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null;
}

function previewTabIdOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string | null {
  if (surface.kind !== "preview" || !surface.resourceId) return null;
  return sessions[surface.resourceId]?.tabId ?? null;
}

/**
 * Stays disabled until desktop overlay state arrives: a server session id can
 * resolve while the preview manager's createTab is still in flight, and muting
 * then fails with a PreviewTabNotFoundError nothing surfaces to the user.
 */
export function tabMuteMenuItem(input: {
  overlay: DesktopPreviewOverlay | null;
  canResolveRuntimeTabId: boolean;
}): { label: string; disabled: boolean } {
  const muted = input.overlay?.audioMuted ?? false;
  return {
    label: muted ? "Unmute tab" : "Mute tab",
    disabled: input.overlay === null || !input.canResolveRuntimeTabId,
  };
}

type TabAudioState = "none" | "audible" | "muted";

function tabAudioState(overlay: DesktopPreviewOverlay | null): TabAudioState {
  if (!overlay?.audible) return "none";
  return overlay.audioMuted ? "muted" : "audible";
}

type SurfaceShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey"
> &
  Partial<Pick<KeyboardEvent, "code" | "getModifierState">>;

export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = surfaceShortcutKey(event);
  return (
    actions.find((action) => action.available && action.shortcut.toLowerCase() === key) ?? null
  );
}

/** Skip contenteditable=false islands to find their editable host, matching the composer typing guard. */
export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string | undefined;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
      aria-keyshortcuts={props.shortcut}
    >
      {props.children}
      <MenuShortcut>{props.shortcut}</MenuShortcut>
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

function RightPanelEmptyState(props: {
  onAddBrowser: () => void;
  onAddBrowserInProfile: (profileId: string) => void;
  browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddPullRequests: () => void;
  onAddDevice: () => void;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  pullRequestsAvailable: boolean;
  deviceAvailable: boolean;
}) {
  const [highlight, setHighlight] = useState(-1);

  const actions = [
    {
      label: "Browser",
      icon: Globe2,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.browser,
      onClick: props.onAddBrowser,
    },
    {
      label: "Terminal",
      icon: TerminalSquare,
      shortcut: "T",
      available: props.terminalAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.terminal,
      onClick: props.onAddTerminal,
    },
    {
      label: "Files",
      icon: Files,
      shortcut: "F",
      available: props.filesAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.files,
      onClick: props.onAddFiles,
    },
    {
      label: "Diff",
      icon: FileDiff,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.diff,
      onClick: props.onAddDiff,
    },
    {
      label: "Pull request",
      icon: PullRequestGlyph.pullRequest,
      shortcut: "P",
      available: props.pullRequestAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.pullRequest,
      onClick: props.onAddPullRequest,
    },
    {
      label: "Pull requests",
      icon: PullRequestGlyph.link,
      shortcut: "L",
      available: props.pullRequestsAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.pullRequests,
      onClick: props.onAddPullRequests,
    },
    {
      label: "Device",
      description: "Watch an iOS Simulator or Android Emulator.",
      icon: Smartphone,
      shortcut: "M",
      available: props.deviceAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.device,
      onClick: props.onAddDevice,
    },
  ] as const;

  type SurfaceAction = (typeof actions)[number];

  const availableActions = actions.filter((action) => action.available);
  const highlightIndex =
    availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1);

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const action = surfaceShortcutActionForKey(availableActions, event);
    if (!action) return;
    if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    const target = event.composedPath()[0] ?? event.target;
    if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
    event.preventDefault();
    event.stopPropagation();
    action.onClick();
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (availableActions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % availableActions.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight(
        highlightIndex === -1
          ? availableActions.length - 1
          : (highlightIndex - 1 + availableActions.length) % availableActions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      if (event.target !== event.currentTarget) return;
      const action = availableActions[highlightIndex];
      if (!action) return;
      event.preventDefault();
      action.onClick();
    }
  };

  const isHighlighted = (action: SurfaceAction) =>
    highlightIndex !== -1 && availableActions[highlightIndex] === action;

  const actionIcon = (action: SurfaceAction, iconClassName = "size-4") => {
    const Icon = action.icon;
    return (
      <span className="relative inline-flex shrink-0">
        <Icon className={iconClassName} />
      </span>
    );
  };

  return (
    <div
      data-workspace-focus-default
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Open a surface"
      data-surface-launcher-keys={availableActions.map((action) => action.shortcut).join("")}
      className={cn(
        "scrollbar-gutter-both flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 outline-none",
        "pb-(--workspace-topbar-height)",
      )}
    >
      <div className="w-full max-w-xs py-6">
        <h3 className="mb-3 text-center font-medium text-foreground text-sm">Open a surface</h3>
        <div className="flex flex-col gap-0.5">
          {actions.map((action) =>
            action.available ? (
              <div
                key={action.label}
                className="group relative"
                onMouseEnter={() => setHighlight(availableActions.indexOf(action))}
                onMouseLeave={() =>
                  setHighlight((current) =>
                    current === availableActions.indexOf(action) ? -1 : current,
                  )
                }
              >
                <button
                  type="button"
                  onClick={action.onClick}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm transition-colors group-hover:bg-accent/60",
                    isHighlighted(action) && "bg-accent/60",
                  )}
                >
                  {actionIcon(action, "size-4")}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      action.label === "Browser" && props.browserProfiles.length > 1 && "pr-7",
                    )}
                  >
                    {action.label}
                  </span>
                  <Kbd>{action.shortcut}</Kbd>
                </button>
                {action.label === "Browser" && props.browserProfiles.length > 1 ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          aria-label="Open browser in a profile"
                          className="absolute top-1/2 right-8 -translate-y-1/2"
                          size="icon-xs"
                          variant="ghost-muted"
                        />
                      }
                    >
                      <ChevronDown className="size-3.5" />
                    </MenuTrigger>
                    <MenuPopup align="end" side="bottom" sideOffset={6} className="max-w-56">
                      {props.browserProfiles.map((profile) => (
                        <MenuItem
                          key={profile.id}
                          onClick={() => props.onAddBrowserInProfile(profile.id)}
                        >
                          <span className="min-w-0 truncate">{profile.name}</span>
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                ) : null}
              </div>
            ) : (
              <DisabledReasonTooltip
                key={action.label}
                reason={action.disabledReason}
                trigger={
                  <div
                    tabIndex={0}
                    aria-disabled="true"
                    className="flex h-8 w-full cursor-default items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm opacity-50"
                  >
                    {actionIcon(action, "size-4")}
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    <Kbd>{action.shortcut}</Kbd>
                  </div>
                }
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewFavicon({ capturedUrl, url }: { capturedUrl: string | null; url: string | null }) {
  const publicProviderUrl = faviconUrlForOrigin(url, 32);
  return (
    <FaviconImage
      sources={[capturedUrl, publicProviderUrl]}
      fallback={<Globe2 className="size-3.5 shrink-0" />}
      className="size-3.5 shrink-0 rounded-sm object-contain"
    />
  );
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function previewFaviconOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>,
): { url: string | null; capturedUrl: string | null } {
  const snapshot =
    surface.kind === "preview" && surface.resourceId ? sessions[surface.resourceId] : null;
  const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
  const favicon = snapshot ? (desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
  const capturedUrl = favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null;
  return { url, capturedUrl };
}

function SurfaceIcon({
  surface,
  previewUrl,
  previewCapturedUrl,
  theme,
  pullRequestStatus,
}: {
  surface: RightPanelSurface;
  previewUrl: string | null;
  previewCapturedUrl: string | null;
  theme: "light" | "dark";
  pullRequestStatus: PullRequestTabState | null;
}) {
  switch (surface.kind) {
    case "preview":
      return <PreviewFavicon capturedUrl={previewCapturedUrl} url={previewUrl} />;
    case "diff":
      return <FileDiff className="size-3.5 shrink-0" />;
    case "files":
      return <Files className="size-3.5 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3.5"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3.5 shrink-0" />;
    case "pull-request":
      return <PullRequestSurfaceIcon status={pullRequestStatus} />;
    case "pull-requests":
      return <PullRequestGlyph.link className="size-3.5 shrink-0" />;
    case "device":
      return surface.target?.platform === "ios" ? (
        <AppleIcon className="size-3.5 shrink-0" />
      ) : surface.target?.platform === "android" ? (
        <AndroidIcon className="size-3.5 shrink-0" />
      ) : (
        <Smartphone className="size-3.5 shrink-0" />
      );
  }
}

export function resolvePullRequestTabLink(
  threads: readonly Pick<EnvironmentThreadShell, "environmentId" | "pullRequests">[],
  environmentId: EnvironmentId | null,
  host: string | null,
  reference: { repository: string; number: number },
) {
  if (environmentId === null || host === null) return undefined;
  let newest: EnvironmentThreadShell["pullRequests"][number] | undefined;
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      if (
        !threadPullRequestKeysEqual(link, {
          host,
          repository: reference.repository,
          number: reference.number,
        })
      )
        continue;
      if (
        newest === undefined ||
        (link.snapshot?.syncedAt ?? "") > (newest.snapshot?.syncedAt ?? "")
      )
        newest = link;
    }
  }
  return newest;
}

type PullRequestTabState = PullRequestTabStatusSeed;

/**
 * A pull request tab's lifecycle and draft state: the linked snapshot, then fetched detail or the
 * shared summary, then the caller's seed. Null until one of them is known.
 */
function usePullRequestTabState(
  surface: Extract<RightPanelSurface, { kind: "pull-request" }>,
  environmentId: EnvironmentId | null,
  seed: PullRequestTabStatusSeed | undefined,
): PullRequestTabState | null {
  const resolvedEnvironmentId =
    (surface.environmentId as EnvironmentId | undefined) ?? environmentId;
  const projects = useProjects();
  const threads = useThreadShells();
  const project = projects.find(
    (entry) => entry.environmentId === resolvedEnvironmentId && entry.id === surface.projectId,
  );
  const identity = project?.repositoryIdentity;
  const host =
    surface.host ??
    (identity?.provider
      ? pullRequestHostOf(identity, identity.provider as SourceControlProviderKind)
      : null);
  const configs = useServerConfigs();
  const capabilities =
    resolvedEnvironmentId === null
      ? undefined
      : configs.get(resolvedEnvironmentId)?.environment.capabilities;
  const linkedSnapshot =
    capabilities?.threadPullRequests === true
      ? (resolvePullRequestTabLink(threads, resolvedEnvironmentId, host, surface)?.snapshot ?? null)
      : null;
  const detail = useEnvironmentQuery(
    resolvedEnvironmentId === null || capabilities?.pullRequests !== true || linkedSnapshot !== null
      ? null
      : pullRequestEnvironment.detail({
          environmentId: resolvedEnvironmentId,
          input: {
            projectId: surface.projectId as ProjectId,
            ...(capabilities?.threadPullRequests === true && surface.host !== undefined
              ? { host: surface.host }
              : {}),
            repository: surface.repository,
            number: surface.number,
          },
        }),
  ).data;
  const reference = useMemo(
    () => ({
      projectId: surface.projectId as ProjectId,
      repository: surface.repository,
      number: surface.number,
    }),
    [surface.projectId, surface.repository, surface.number],
  );
  const sharedSummary = useSharedPullRequestSummary(resolvedEnvironmentId, reference, null);
  // The compact tab intentionally shows lifecycle and draft state only. Conflict warnings have
  // their own presentation on surfaces that have mergeability, while this tab stays stable as
  // detail data arrives.
  const status = linkedSnapshot ?? newestPullRequestSummary(detail, sharedSummary) ?? seed ?? null;
  const state = status?.state;
  const isDraft = status?.isDraft ?? detail?.isDraft ?? seed?.isDraft ?? false;
  return useMemo(() => (state === undefined ? null : { state, isDraft }), [state, isDraft]);
}

function PullRequestSurfaceIcon({ status }: { status: PullRequestTabState | null }) {
  if (status === null) {
    return <PullRequestGlyph.pullRequest className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  const presentation = resolvePullRequestState(status);
  return <presentation.Icon className={cn("size-3.5 shrink-0", presentation.toneClassName)} />;
}

function SortableTabList(props: {
  surfaces: readonly RightPanelSurface[];
  onMove: ((surfaceId: string, toIndex: number) => void) | undefined;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const surfaceIds = props.surfaces.map((surface) => surface.id);
  const { onMove, surfaces } = props;
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const toIndex = surfaces.findIndex((surface) => surface.id === over.id);
    if (toIndex >= 0) onMove?.(String(active.id), toIndex);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={TAB_DRAG_MODIFIERS}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={surfaceIds} strategy={horizontalListSortingStrategy}>
        {props.children}
      </SortableContext>
    </DndContext>
  );
}

interface RightPanelTabHandlers {
  onActivate: (surface: RightPanelSurface) => void;
  onClose: (surface: RightPanelSurface) => void;
  onAuxClick: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
  onContextMenu: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
  onStartRename: (surfaceId: string) => void;
  onFinishRename: (surfaceId: string, title: string) => void;
}

// Chromium on Linux only suppresses primary-selection paste when mouseup is cancelled.
function preventTabMiddleButtonDefault(event: ReactMouseEvent) {
  if (event.button !== 1) return;
  event.preventDefault();
}

type RightPanelTabProps = RightPanelTabHandlers & {
  surface: RightPanelSurface;
  dragDisabled: boolean;
  active: boolean;
  pending: boolean;
  /** The surface's bare name, for actions such as "Close Diff". */
  title: string;
  /** The name and its state in words, such as "Diff" and "5 files". */
  label: SurfaceTitleParts;
  /** The strip's one Tab stop: the selected tab, or the first when none is. */
  focusable: boolean;
  /** A process runs in this tab; shown as a neutral dot beside the label that names it. */
  running: boolean;
  audio: TabAudioState;
  audioRuntimeTabId: string | null;
  previewUrl: string | null;
  previewCapturedUrl: string | null;
  theme: "light" | "dark";
  environmentId: EnvironmentId | null;
  pullRequestStatus: PullRequestTabState | null;
  renaming: boolean;
  canRename: boolean;
  ownsDesktopTitleBar: boolean;
  /** The id of the tab panel every tab controls. */
  panelId: string;
  /** The keys that close this tab, for `aria-keyshortcuts`. */
  closeKeyShortcuts: string;
};

const NO_PREVIEW_SESSIONS: Readonly<Record<string, PreviewSessionSnapshot>> = {};
const NO_TERMINAL_LABELS: ReadonlyMap<string, string> = new Map();

/** A pull request tab resolves its own state, so its label and glyph can say it. */
function PullRequestPanelTab(
  props: Omit<RightPanelTabProps, "surface" | "label" | "pullRequestStatus"> & {
    surface: Extract<RightPanelSurface, { kind: "pull-request" }>;
    pullRequestStatusSeed: PullRequestTabStatusSeed | undefined;
  },
) {
  const { pullRequestStatusSeed, ...tabProps } = props;
  const status = usePullRequestTabState(props.surface, props.environmentId, pullRequestStatusSeed);
  return (
    <RightPanelTab
      {...tabProps}
      label={surfaceTitleParts(props.surface, NO_PREVIEW_SESSIONS, NO_TERMINAL_LABELS, {
        pullRequestStatus: status,
      })}
      pullRequestStatus={status}
    />
  );
}

/** A process-running dot: solid and neutral, never the working-agent halo. Words always sit beside it. */
function RunningDot() {
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-foreground" />;
}

/** A tab's name, truncated alone, then its state in words, which never shrinks away. */
function TabLabelText({ label }: { label: SurfaceTitleParts }) {
  return (
    <>
      <span className="min-w-0 truncate">{label.name}</span>
      {label.state ? <span className="shrink-0 whitespace-pre"> · {label.state}</span> : null}
    </>
  );
}

// Stable handlers and per-tab values let the compiler reuse tabs across parent renders.
function RightPanelTab(props: RightPanelTabProps) {
  const {
    surface,
    title,
    audio,
    audioRuntimeTabId,
    onActivate,
    onClose,
    onAuxClick,
    onContextMenu,
    onStartRename,
    onFinishRename,
  } = props;
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: surface.id,
    disabled: props.dragDisabled,
    // Neighbours jump into place instead of sliding when motion is reduced.
    ...(prefersReducedMotion() ? { transition: null } : {}),
  });
  // A running terminal shows its dot in place of its icon.
  const identity = (
    <>
      {props.running ? (
        <RunningDot />
      ) : (
        <SurfaceIcon
          surface={surface}
          previewUrl={props.previewUrl}
          previewCapturedUrl={props.previewCapturedUrl}
          theme={props.theme}
          pullRequestStatus={props.pullRequestStatus}
        />
      )}
      {props.pending ? (
        <span
          className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
          aria-hidden
        />
      ) : null}
    </>
  );
  // Close and mute buttons stay out of the Tab order and the accessibility tree, so the tablist
  // holds only tabs: Delete, Backspace or Mod+W close (announced by `aria-keyshortcuts`), and the
  // context menu mutes.
  const content = (
    <>
      {props.active ? (
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          {identity}
        </span>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className={cn(
            "cursor-pointer relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted",
            TAB_BUTTON_HIT_AREA_CLASS,
          )}
          aria-label={`Close ${title}`}
          onClick={() => onClose(surface)}
        >
          <span className="relative flex size-3.5 items-center justify-center group-hover/tab:hidden">
            {identity}
          </span>
          <X aria-hidden className="hidden size-3.5 group-hover/tab:block" />
        </button>
      )}
      {audio === "none" || !audioRuntimeTabId ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                className={cn(
                  "cursor-pointer relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted",
                  TAB_BUTTON_HIT_AREA_CLASS,
                )}
                aria-label={audio === "muted" ? `Unmute ${title}` : `Mute ${title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void previewBridge
                    ?.setAudioMuted(audioRuntimeTabId, audio !== "muted")
                    .catch(() => undefined);
                }}
              >
                <MorphIcon className="size-3" icon={audio === "muted" ? VolumeOff : Volume2} />
              </button>
            }
          />
          <TooltipPopup>{audio === "muted" ? "Unmute tab" : "Mute tab"}</TooltipPopup>
        </Tooltip>
      )}
      {props.renaming ? (
        <input
          aria-label="Device tab name"
          className="w-24 min-w-0 rounded-sm bg-background px-1 outline-none ring-1 ring-inset ring-ring"
          defaultValue={title}
          ref={(element) => {
            element?.focus();
            element?.select();
          }}
          onBlur={(event) => onFinishRename(surface.id, event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = title;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                role="tab"
                aria-selected={props.active}
                aria-controls={props.panelId}
                aria-keyshortcuts={props.closeKeyShortcuts}
                tabIndex={props.focusable ? 0 : -1}
                data-panel-tab-trigger
                onDoubleClick={() => {
                  if (surface.kind === "device" && props.canRename) onStartRename(surface.id);
                }}
                className="cursor-pointer flex min-w-0 items-center outline-none"
                onClick={() => onActivate(surface)}
                onKeyDown={(event) => {
                  // Backspace is the delete key on a Mac laptop.
                  if (event.key !== "Delete" && event.key !== "Backspace") return;
                  event.preventDefault();
                  onClose(surface);
                }}
              >
                <TabLabelText label={props.label} />
              </button>
            }
          />
          <TooltipPopup>
            {surface.kind === "device" ? (
              <DeviceTabTooltip
                surface={surface}
                environmentId={props.environmentId}
                title={title}
              />
            ) : (
              <TabLabelText label={props.label} />
            )}
          </TooltipPopup>
        </Tooltip>
      )}
      {props.active ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className={cn(
            "cursor-pointer relative flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
            TAB_BUTTON_HIT_AREA_CLASS,
          )}
          aria-label={`Close ${title}`}
          onClick={() => onClose(surface)}
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </>
  );
  return (
    <div
      role="presentation"
      data-active-tab={props.active}
      data-panel-tab-id={surface.id}
      onMouseDown={preventTabMiddleButtonDefault}
      onMouseUp={preventTabMiddleButtonDefault}
      onAuxClick={(event) => onAuxClick(event, surface)}
      onContextMenu={(event) => onContextMenu(event, surface)}
      {...listeners}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "cursor-pointer group/tab flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium text-xs",
        props.ownsDesktopTitleBar && "[-webkit-app-region:no-drag]",
        props.active ? PANEL_TAB_ACTIVE_CLASS : PANEL_TAB_IDLE_CLASS,
        // The focus ring sits inside the tab, which the track would otherwise clip.
        "has-[[data-panel-tab-trigger]:focus-visible]:ring-2 has-[[data-panel-tab-trigger]:focus-visible]:ring-ring has-[[data-panel-tab-trigger]:focus-visible]:ring-inset",
        isDragging && "relative z-10",
      )}
    >
      {content}
    </div>
  );
}

const PANEL_TAB_ACTIVE_CLASS =
  "bg-card font-semibold text-foreground ring-1 ring-inset ring-primary-edge";
const PANEL_TAB_IDLE_CLASS = "text-muted-foreground hover:bg-card/60 hover:text-foreground";
const RUN_DETAILS_TAB_ID = "run-details";
// A 16px glyph button that still takes a 24px hit, without widening the tab around it.
const TAB_BUTTON_HIT_AREA_CLASS = "before:absolute before:-inset-1 before:content-['']";

/**
 * The surface id of the panel tab `target` is, or null when it is not a closable tab. A close
 * shortcut uses it so Mod+W closes the tab that has focus in the strip, not only the selected one.
 */
export function focusedPanelTabSurfaceId(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return null;
  const id = target.closest<HTMLElement>("[data-panel-tab-id]")?.dataset.panelTabId ?? null;
  return id === RUN_DETAILS_TAB_ID ? null : id;
}

/** Whether keyboard focus is on the Run details tab, which never closes. */
export function isRunDetailsTabFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return false;
  return (
    target.closest<HTMLElement>("[data-panel-tab-id]")?.dataset.panelTabId === RUN_DETAILS_TAB_ID
  );
}

/** A tab the strip cannot show, as the "N more" menu lists it. Run details has no surface. */
interface HiddenPanelTab {
  id: string;
  label: SurfaceTitleParts;
  running: number;
  surface: RightPanelSurface | null;
}

/** A pull request row in the "N more" menu resolves its state the way its tab does. */
function PullRequestMenuRowLabel(props: {
  surface: Extract<RightPanelSurface, { kind: "pull-request" }>;
  environmentId: EnvironmentId | null;
  seed: PullRequestTabStatusSeed | undefined;
}) {
  const status = usePullRequestTabState(props.surface, props.environmentId, props.seed);
  return (
    <TabLabelText
      label={surfaceTitleParts(props.surface, NO_PREVIEW_SESSIONS, NO_TERMINAL_LABELS, {
        pullRequestStatus: status,
      })}
    />
  );
}

/** Moves focus between a strip's tabs with the arrow keys, Home and End; Enter selects. */
function handleTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const index = tabs.indexOf(target);
  if (index < 0) return;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** A thread's first tab, the panel's resting view. Always present; not sortable or closable. */
function RunDetailsTab(props: {
  active: boolean;
  focusable: boolean;
  panelId: string;
  ownsDesktopTitleBar: boolean;
  onShow: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      aria-controls={props.panelId}
      tabIndex={props.focusable ? 0 : -1}
      data-active-tab={props.active}
      data-panel-tab-id={RUN_DETAILS_TAB_ID}
      onClick={props.onShow}
      className={cn(
        "cursor-pointer flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        props.ownsDesktopTitleBar && "[-webkit-app-region:no-drag]",
        props.active ? PANEL_TAB_ACTIVE_CLASS : PANEL_TAB_IDLE_CLASS,
      )}
    >
      <ListTree aria-hidden className="size-3.5 shrink-0" />
      Run details
    </button>
  );
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const focusedSurface = props.surfaces.find((surface) => surface.id === props.activeSurfaceId);
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const browserProfiles = useBrowserDefaults().profiles;
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const addSurfaceTriggerRef = useRef<HTMLButtonElement>(null);
  const [renamingDevice, setRenamingDevice] = useState<string | null>(null);
  const [addSurfaceMenuOpen, setAddSurfaceMenuOpen] = useState(false);
  // Tabs the strip cannot fully show, in tab order; listed by the "N more" menu.
  const [hiddenTabIds, setHiddenTabIds] = useState<readonly string[]>([]);
  const runningTerminalIds = useMemo(
    () => new Set(props.runningTerminalIds ?? []),
    [props.runningTerminalIds],
  );
  const titleState = { changedFileCount: props.changedFileCount ?? 0, runningTerminalIds };
  const panelId = useId();
  const closeKeyShortcuts = useMemo(
    () =>
      closeTabKeyShortcuts(
        effectiveShortcutsForCommand(props.keybindings, "rightPanel.close", {
          context: { terminalFocus: false },
        })[0] ?? null,
        navigator.platform,
      ),
    [props.keybindings],
  );
  // Whether focus was last in the strip, so closing the focused tab can hand focus to the tab
  // that becomes selected instead of dropping it to the page.
  const stripHadFocusRef = useRef(false);
  useEffect(() => {
    if (!stripHadFocusRef.current) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.isConnected) return;
    const selectedId = props.activeSurfaceId ?? RUN_DETAILS_TAB_ID;
    const tab = Array.from(
      tabListRef.current?.querySelectorAll<HTMLElement>("[data-panel-tab-id]") ?? [],
    ).find((element) => element.dataset.panelTabId === selectedId);
    const trigger =
      tab?.getAttribute("role") === "tab" ? tab : tab?.querySelector<HTMLElement>('[role="tab"]');
    trigger?.focus();
  }, [props.surfaces, props.activeSurfaceId]);

  if (props.open === false && addSurfaceMenuOpen) setAddSurfaceMenuOpen(false);

  const onNewSurfaceKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (
      resolveShortcutCommand(event, props.keybindings, {
        context: { ...props.getShortcutContext(), rightPanelOpen: true },
      }) !== "rightPanel.new"
    )
      return;
    if (!addSurfaceMenuOpen && document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) openNewSurfaceMenu();
  });
  const openNewSurfaceMenu = useEffectEvent(() => {
    addSurfaceTriggerRef.current?.focus();
    setAddSurfaceMenuOpen(true);
  });
  useEffect(() => {
    if (props.open === false) return;
    document.addEventListener("keydown", onNewSurfaceKeyDown, true);
    const unsubscribe = onRightPanelNewMenuRequest(openNewSurfaceMenu);
    return () => {
      document.removeEventListener("keydown", onNewSurfaceKeyDown, true);
      unsubscribe();
    };
  }, [props.open]);

  const updateHiddenTabs = (viewport: HTMLDivElement) => {
    const bounds = viewport.getBoundingClientRect();
    const extents: TabExtent[] = [];
    for (const element of viewport.querySelectorAll<HTMLElement>("[data-panel-tab-id]")) {
      const rect = element.getBoundingClientRect();
      extents.push({ id: element.dataset.panelTabId ?? "", start: rect.left, end: rect.right });
    }
    const next = tabsOutOfView(extents, bounds.left, bounds.right);
    setHiddenTabIds((current) =>
      current.length === next.length && current.every((id, index) => id === next[index])
        ? current
        : next,
    );
  };

  const hiddenTabs = hiddenTabIds.flatMap((id): HiddenPanelTab[] => {
    if (id === RUN_DETAILS_TAB_ID && props.onShowRunDetails) {
      return [{ id, label: { name: "Run details", state: null }, running: 0, surface: null }];
    }
    const surface = props.surfaces.find((entry) => entry.id === id);
    if (!surface) return [];
    return [
      {
        id,
        label: surfaceTitleParts(
          surface,
          props.previewSessions,
          props.terminalLabelsById,
          titleState,
        ),
        running: runningTerminalCount(surface, runningTerminalIds),
        surface,
      },
    ];
  });
  // One Tab stop per strip: the selected tab, else the first.
  const focusableTabId =
    props.activeSurfaceId !== null &&
    props.surfaces.some((entry) => entry.id === props.activeSurfaceId)
      ? props.activeSurfaceId
      : props.onShowRunDetails
        ? RUN_DETAILS_TAB_ID
        : (props.surfaces[0]?.id ?? null);
  const hiddenRunningCount = hiddenTabs.reduce((sum, tab) => sum + tab.running, 0);
  const overflowLabel = overflowMenuLabel(hiddenTabs.length, hiddenRunningCount);

  const addSurfaceActions = [
    {
      label: "Browser",
      icon: Globe2,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.browser,
      onClick: props.onAddBrowser,
    },
    {
      label: "Terminal",
      icon: TerminalSquare,
      shortcut: "T",
      available: props.terminalAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.terminal,
      onClick: props.onAddTerminal,
    },
    {
      label: "Files",
      icon: Files,
      shortcut: "F",
      available: props.filesAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.files,
      onClick: props.onAddFiles,
    },
    {
      label: "Diff",
      icon: FileDiff,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.diff,
      onClick: props.onAddDiff,
    },
    {
      label: "Pull request",
      icon: PullRequestGlyph.pullRequest,
      shortcut: "P",
      available: props.pullRequestAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.pullRequest,
      onClick: props.onAddPullRequest,
    },
    {
      label: "Pull requests",
      icon: PullRequestGlyph.link,
      shortcut: "L",
      available: props.pullRequestsAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.pullRequests,
      onClick: props.onAddPullRequests,
    },
    ...(props.onShowRunDetails
      ? [
          {
            label: "Run details",
            icon: ListTree,
            shortcut: "O",
            available: true,
            disabledReason: undefined,
            onClick: props.onShowRunDetails,
          },
        ]
      : []),
    {
      label: "Device",
      icon: Smartphone,
      shortcut: "M",
      available: props.deviceAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.device,
      onClick: props.onAddDevice,
    },
  ] as const;

  const handleAddSurfaceMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = surfaceShortcutActionForKey(addSurfaceActions, event.nativeEvent);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    setAddSurfaceMenuOpen(false);
    action.onClick();
  };

  const handleTabContextMenu = async (event: ReactMouseEvent, surface: RightPanelSurface) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) return;

    const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;

    const items: ContextMenuItem<TabContextMenuAction>[] = [];
    if (surface.kind === "device" && props.onRenameDevice)
      items.push({ id: "rename", label: "Rename" });
    if (surface.kind === "file" && surface.attachment === undefined) {
      items.push({ id: "copy-path", label: "Copy path" });
    }
    const menuPreviewTabId = previewTabIdOf(surface, props.previewSessions);
    const menuOverlay = menuPreviewTabId ? (props.desktopByTabId[menuPreviewTabId] ?? null) : null;
    const menuMuted = menuOverlay?.audioMuted ?? false;
    if (surface.kind === "preview") {
      items.push({
        id: "toggle-mute",
        ...tabMuteMenuItem({
          overlay: menuOverlay,
          canResolveRuntimeTabId: props.previewRuntimeTabId !== undefined,
        }),
      });
    }
    // The keyboard route to reordering, which otherwise needs a drag.
    if (props.onMoveSurface && props.surfaces.length > 1) {
      items.push(
        { id: "move-left", label: "Move left", disabled: surfaceIndex === 0 },
        {
          id: "move-right",
          label: "Move right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
      );
    }
    items.push(
      { id: "close", label: "Close" },
      {
        id: "close-others",
        label: "Close others",
        disabled: props.surfaces.length <= 1,
      },
      {
        id: "close-to-right",
        label: "Close to the right",
        disabled: surfaceIndex >= props.surfaces.length - 1,
      },
      {
        id: "close-all",
        label: "Close all",
        disabled: props.surfaces.length === 0,
      },
    );

    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    switch (action) {
      case "rename":
        setRenamingDevice(surface.id);
        break;
      case "copy-path":
        if (surface.kind === "file" && surface.attachment === undefined) {
          props.onCopyFilePath(surface.relativePath);
        }
        break;
      case "toggle-mute": {
        const runtimeTabId =
          menuPreviewTabId && menuOverlay
            ? (props.previewRuntimeTabId?.(menuPreviewTabId) ?? null)
            : null;
        if (runtimeTabId) {
          void previewBridge?.setAudioMuted(runtimeTabId, !menuMuted).catch(() => undefined);
        }
        break;
      }
      case "move-left":
        props.onMoveSurface?.(surface.id, surfaceIndex - 1);
        break;
      case "move-right":
        props.onMoveSurface?.(surface.id, surfaceIndex + 1);
        break;
      case "close":
        props.onCloseSurface(surface);
        break;
      case "close-others":
        props.onCloseOtherSurfaces(surface);
        break;
      case "close-to-right":
        props.onCloseSurfacesToRight(surface);
        break;
      case "close-all":
        props.onCloseAllSurfaces();
        break;
      case null:
        break;
    }
  };
  const handleTabAuxClick = (event: ReactMouseEvent, surface: RightPanelSurface) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    props.onCloseSurface(surface);
  };
  const onActivateTab = useStableCallback(props.onActivate);
  const onCloseTab = useStableCallback(props.onCloseSurface);
  const onTabAuxClick = useStableCallback(handleTabAuxClick);
  const onTabContextMenu = useStableCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      void handleTabContextMenu(event, surface);
    },
  );
  const onStartRenameTab = useStableCallback((surfaceId: string) => setRenamingDevice(surfaceId));
  const onFinishRenameTab = useStableCallback((surfaceId: string, title: string) => {
    props.onRenameDevice?.(surfaceId, title);
    setRenamingDevice(null);
  });

  // A newly active tab, or tabs that start overflowing, can sit outside the scrolled strip.
  const hasHiddenTabs = hiddenTabIds.length > 0;
  useEffect(() => {
    if (!hasHiddenTabs) return;
    const activeId = props.activeSurfaceId ?? RUN_DETAILS_TAB_ID;
    const activeTab = Array.from(
      tabListRef.current?.querySelectorAll<HTMLElement>("[data-panel-tab-id]") ?? [],
    ).find((element) => element.dataset.panelTabId === activeId);
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId, hasHiddenTabs]);

  const attachTabList = (root: HTMLDivElement | null) => {
    tabListRef.current = root;
    const viewport = tabScrollViewport(root);
    if (!viewport) return;

    const update = () => updateHiddenTabs(viewport);
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      let delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= viewport.clientWidth;
      if (delta === 0) return;

      const previousScrollLeft = viewport.scrollLeft;
      viewport.scrollLeft += delta;
      if (viewport.scrollLeft === previousScrollLeft) return;
      event.preventDefault();
      update();
    };

    const content = viewport.firstElementChild;
    const stopObserving = observeResize(content ? [viewport, content] : viewport, update);
    viewport.addEventListener("scroll", update, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    update();

    return () => {
      tabListRef.current = null;
      stopObserving();
      viewport.removeEventListener("scroll", update);
      viewport.removeEventListener("wheel", handleWheel);
    };
  };

  return (
    <PreviewPanelShell
      workspaceArea
      workspaceFocusKey={`panel:${props.environmentId}:${props.activeSurfaceId ?? "empty"}`}
      workspaceLabel={
        focusedSurface
          ? `Workspace panel: ${surfaceTitle(focusedSurface, props.previewSessions, props.terminalLabelsById, titleState)}`
          : props.onShowRunDetails
            ? "Workspace panel: Run details"
            : "Workspace panel"
      }
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-border bg-sidebar surface-grain pl-3",
          props.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
          ownsDesktopTitleBar && "drag-region",
          ownsDesktopTitleBar && "wco:pr-(--workspace-native-controls-inset)",
          props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          ref={attachTabList}
          hideScrollbars
          scrollFade
          // Sized to its tabs so Add sits beside them; shrinks and scrolls when they do not fit.
          className="w-auto min-w-0 flex-initial"
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center">
            <div
              role="tablist"
              aria-label="Panel tabs"
              onKeyDown={handleTabListKeyDown}
              onFocus={() => {
                stripHadFocusRef.current = true;
              }}
              onBlur={(event) => {
                // A removed tab blurs with no related target; focus that moved elsewhere has one.
                if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
                  stripHadFocusRef.current = false;
                }
              }}
              className={cn(
                // One track at every tab count, so the bar never changes shape as tabs come and go.
                "flex h-8 items-center gap-0.5 rounded-lg bg-surface-well p-0.5",
                props.surfaces.length === 0 && !props.onShowRunDetails && "hidden",
              )}
            >
              {props.onShowRunDetails ? (
                <RunDetailsTab
                  active={props.activeSurfaceId === null}
                  focusable={focusableTabId === RUN_DETAILS_TAB_ID}
                  panelId={panelId}
                  ownsDesktopTitleBar={ownsDesktopTitleBar}
                  onShow={props.onShowRunDetails}
                />
              ) : null}
              <SortableTabList surfaces={props.surfaces} onMove={props.onMoveSurface}>
                {props.surfaces.map((surface) => {
                  const previewTabId = previewTabIdOf(surface, props.previewSessions);
                  const favicon = previewFaviconOf(
                    surface,
                    props.previewSessions,
                    props.desktopByTabId,
                  );
                  const tabProps = {
                    dragDisabled: !props.onMoveSurface || renamingDevice === surface.id,
                    active: surface.id === props.activeSurfaceId,
                    focusable: surface.id === focusableTabId,
                    pending: props.pendingSurfaceIds.has(surface.id),
                    title: surfaceTitle(surface, props.previewSessions, props.terminalLabelsById),
                    running: runningTerminalCount(surface, runningTerminalIds) > 0,
                    audio: tabAudioState(
                      previewTabId ? (props.desktopByTabId[previewTabId] ?? null) : null,
                    ),
                    audioRuntimeTabId: previewTabId
                      ? (props.previewRuntimeTabId?.(previewTabId) ?? null)
                      : null,
                    previewUrl: favicon.url,
                    previewCapturedUrl: favicon.capturedUrl,
                    theme: resolvedTheme,
                    environmentId: props.environmentId,
                    renaming: renamingDevice === surface.id,
                    canRename: props.onRenameDevice !== undefined,
                    ownsDesktopTitleBar,
                    panelId,
                    closeKeyShortcuts,
                    onActivate: onActivateTab,
                    onClose: onCloseTab,
                    onAuxClick: onTabAuxClick,
                    onContextMenu: onTabContextMenu,
                    onStartRename: onStartRenameTab,
                    onFinishRename: onFinishRenameTab,
                  };
                  return surface.kind === "pull-request" ? (
                    <PullRequestPanelTab
                      key={surface.id}
                      {...tabProps}
                      surface={surface}
                      pullRequestStatusSeed={props.pullRequestStatusSeeds?.[surface.id]}
                    />
                  ) : (
                    <RightPanelTab
                      key={surface.id}
                      {...tabProps}
                      surface={surface}
                      label={surfaceTitleParts(
                        surface,
                        props.previewSessions,
                        props.terminalLabelsById,
                        titleState,
                      )}
                      pullRequestStatus={null}
                    />
                  );
                })}
              </SortableTabList>
            </div>
          </div>
        </ScrollArea>
        {hiddenTabs.length > 0 ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={overflowLabel.ariaLabel}
                  className="shrink-0 [-webkit-app-region:no-drag]"
                  size="compact"
                  variant="outline"
                />
              }
            >
              {hiddenRunningCount > 0 ? <RunningDot /> : null}
              {overflowLabel.text}
              <ChevronDown aria-hidden className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" side="bottom" sideOffset={6} className="max-w-64">
              {hiddenTabs.map((tab) => (
                <MenuItem
                  key={tab.id}
                  onClick={() => {
                    if (tab.surface) props.onActivate(tab.surface);
                    else props.onShowRunDetails?.();
                  }}
                >
                  {tab.running > 0 ? <RunningDot /> : null}
                  <span className="flex min-w-0 items-center">
                    {tab.surface?.kind === "pull-request" ? (
                      <PullRequestMenuRowLabel
                        surface={tab.surface}
                        environmentId={props.environmentId}
                        seed={props.pullRequestStatusSeeds?.[tab.surface.id]}
                      />
                    ) : (
                      <TabLabelText label={tab.label} />
                    )}
                  </span>
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}
        {props.open !== false ? (
          <Menu open={addSurfaceMenuOpen} onOpenChange={setAddSurfaceMenuOpen}>
            <MenuTrigger
              ref={addSurfaceTriggerRef}
              render={
                <Button
                  aria-label="Add a panel tab"
                  className="shrink-0"
                  size="icon-xs"
                  variant="ghost-muted"
                />
              }
            >
              <Plus className="size-3.5" />
            </MenuTrigger>
            <MenuPopup
              align="start"
              side="bottom"
              sideOffset={6}
              onKeyDownCapture={handleAddSurfaceMenuKeyDown}
            >
              {addSurfaceActions.map((action) => {
                const Icon = action.icon;
                if (action.label === "Browser" && action.available) {
                  return (
                    <MenuSub key={action.label}>
                      <MenuSubTrigger
                        className="[&>svg:last-child]:ms-0"
                        aria-keyshortcuts={action.shortcut}
                        onClick={(event) => {
                          const pointerType =
                            "pointerType" in event.nativeEvent &&
                            typeof event.nativeEvent.pointerType === "string"
                              ? event.nativeEvent.pointerType
                              : undefined;
                          if (!shouldOpenDefaultBrowserProfileFromMenuClick(pointerType)) return;
                          setAddSurfaceMenuOpen(false);
                          action.onClick();
                        }}
                      >
                        <Icon />
                        {action.label}
                        <MenuShortcut>{action.shortcut}</MenuShortcut>
                      </MenuSubTrigger>
                      <MenuSubPopup className="max-w-56">
                        {browserProfiles.map((profile) => (
                          <MenuItem
                            key={profile.id}
                            onClick={() => props.onAddBrowserInProfile(profile.id)}
                          >
                            <span className="min-w-0 truncate">{profile.name}</span>
                          </MenuItem>
                        ))}
                      </MenuSubPopup>
                    </MenuSub>
                  );
                }
                return (
                  <SurfaceMenuItem
                    key={action.label}
                    available={action.available}
                    disabledReason={action.disabledReason}
                    shortcut={action.shortcut}
                    onClick={action.onClick}
                  >
                    <Icon />
                    {action.label}
                  </SurfaceMenuItem>
                );
              })}
            </MenuPopup>
          </Menu>
        ) : null}
        <span aria-hidden className="min-w-0 flex-1" />
        {props.layoutControls}
        {ownsDesktopTitleBar && !props.layoutControls ? (
          <span aria-hidden className="hidden w-24 shrink-0 wco:block" />
        ) : null}
        {ownsDesktopTitleBar ? (
          <span
            aria-hidden
            className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
          />
        ) : null}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-right-panel-surface-content
        id={panelId}
        {...(props.activeSurfaceId === null && !props.onShowRunDetails
          ? {}
          : {
              role: "tabpanel",
              "aria-label": focusedSurface
                ? surfaceTitle(focusedSurface, props.previewSessions, props.terminalLabelsById)
                : "Run details",
            })}
      >
        {props.activeSurfaceId === null && !props.onShowRunDetails ? (
          <RightPanelEmptyState
            onAddBrowser={props.onAddBrowser}
            onAddBrowserInProfile={props.onAddBrowserInProfile}
            browserProfiles={browserProfiles}
            onAddTerminal={props.onAddTerminal}
            onAddDiff={props.onAddDiff}
            onAddFiles={props.onAddFiles}
            onAddPullRequest={props.onAddPullRequest}
            onAddPullRequests={props.onAddPullRequests}
            onAddDevice={props.onAddDevice}
            browserAvailable={props.browserAvailable}
            terminalAvailable={props.terminalAvailable}
            diffAvailable={props.diffAvailable}
            filesAvailable={props.filesAvailable}
            pullRequestAvailable={props.pullRequestAvailable}
            pullRequestsAvailable={props.pullRequestsAvailable}
            deviceAvailable={props.deviceAvailable}
          />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}

function DeviceTabTooltip(props: {
  surface: Extract<RightPanelSurface, { kind: "device" }>;
  environmentId: EnvironmentId | null;
  title: string;
}) {
  const target = props.surface.target;
  const { state } = useDeviceState(target ? props.environmentId : null);
  const device = target
    ? state.devices.find((entry) => entry.hostId === target.hostId && entry.id === target.deviceId)
    : undefined;
  const host = target ? state.hosts.find((entry) => entry.id === target.hostId) : undefined;
  return (
    <div className="flex flex-col gap-0.5">
      <span>{props.title}</span>
      {target ? (
        <span className="text-muted-foreground">
          {host?.label ?? "Device host"} ·{" "}
          {device?.version ?? (target.platform === "ios" ? "iOS" : "Android")}
        </span>
      ) : null}
    </div>
  );
}
