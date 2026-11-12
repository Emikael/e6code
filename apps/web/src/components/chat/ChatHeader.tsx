import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@e6tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentProject } from "@e6tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import {
  formatRunningThreadStatus,
  joinThreadRowStatus,
} from "@e6tools/client-runtime/state/agent-state";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  EllipsisIcon,
  EyeIcon,
  FileIcon,
  FocusIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  PencilIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import GitActionsControl from "../GitActionsControl";
import { isTrailingDoubleClick, resolveSidebarThreadStatus } from "../Sidebar.logic";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { useRemoteOpenState, type RemoteOpenMode } from "../../remoteOpen";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useE6ProjectFileScripts } from "~/hooks/useE6ProjectFileScripts";
import { useProjectGroupDisplayName } from "~/hooks/useProjectGroupDisplayName";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { readLocalApi } from "~/localApi";
import { threadEnvironment } from "../../state/threads";
import { useThreadShell } from "../../state/entities";
import { useClientSettings } from "~/hooks/useSettings";
import { formatDayAwareTimestamp, formatUpcomingTimestamp } from "~/timestampFormat";
import { doneSummary } from "./ThreadNowBar.logic";
import { useAtomCommand } from "../../state/use-atom-command";
import { EnvironmentConnectionChip } from "../EnvironmentConnectionChip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { useRouter } from "@tanstack/react-router";
import { useThreadAttention } from "~/hooks/useThreadAttention";
import { goToNextThreadThatNeedsYou } from "~/lib/needsYouNavigation";
import { shortcutLabelForCommand } from "~/keybindings";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  /** Drafts have no server thread yet, so the title carries no action menu. */
  isServerThread: boolean;
  activeProject: EnvironmentProject | null;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  /** Files the agent has changed in this thread; null hides the slot (drafts). */
  changedFileCount: number | null;
  /** The now bar under the header is showing; it carries the status, so the pill steps aside. */
  nowBarShown?: boolean;
  /** The finished turn, for the focus bar's "Ready to review · worked 3m 40s · finished 14:06". */
  doneTurn?: { readonly workedFor: string | null; readonly finishedAt: string } | null;
  /** Opens the Diff panel on the working tree. */
  onOpenChanges: () => void;
  gitCwd: string | null;
  readonly onOpenPullRequest?: ((number: number) => void) | undefined;
  onNewThreadInProject: () => void;
  onOpenProjectSettings?: (() => void) | undefined;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  /** Focus mode turns the header into the focus bar (board 3). */
  focusMode: boolean;
  onToggleFocus: () => void;
}

/**
 * Rename commit rule shared with the sidebar's inline rename: trim, reject
 * empty (the caller toasts), and skip the mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

type ThreadHeaderStatusKind =
  | "approval"
  | "input"
  | "paused"
  | "working"
  | "monitoring"
  | "failed"
  | "done";

interface ThreadHeaderStatus {
  readonly kind: ThreadHeaderStatusKind;
  readonly label: string;
  /** Truncatable detail after the label, such as "step 4 of 6". */
  readonly detail: string | null;
}

/**
 * Header status pill for the open thread. Uses the sidebar's resolution and
 * the shared running-status detail so both surfaces agree ("Working · step 4
 * of 6", "Waiting for usage limit · resets 14:20"), with full wording for attention states
 * since the header has room. A resting thread reads Done only after a
 * completed turn; a fresh or stopped thread shows no pill.
 */
export function resolveThreadHeaderStatus(
  thread: Pick<
    EnvironmentThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "session"
    | "backgroundLiveness"
    | "agentState"
    | "latestTurn"
    | "planProgress"
  >,
  formatResetTime: (resetsAt: string) => string,
): ThreadHeaderStatus | null {
  const status = resolveSidebarThreadStatus(thread);
  switch (status) {
    case "approval":
      return { kind: "approval", label: "Needs approval", detail: null };
    case "input":
      return { kind: "input", label: "Needs your answer", detail: null };
    case "paused":
    case "working":
      return {
        kind: status,
        ...formatRunningThreadStatus({
          agentState: thread.agentState,
          planProgress: thread.planProgress,
          formatResetTime,
        }),
      };
    case "monitoring":
      return { kind: "monitoring", label: "Monitoring", detail: null };
    case "failed":
      return { kind: "failed", label: "Failed", detail: null };
    case "ready":
      return thread.latestTurn?.state === "completed"
        ? { kind: "done", label: "Done", detail: null }
        : null;
  }
}

// Each state takes the semantic tone its sidebar row status uses (resolveSidebarRowStatus), on a
// matching wash: paused, approval and answer read as warning, failed as destructive, done as success. A
// working agent reads as the live accent with a dot; every other state shows a glyph, and the
// label always names the state.
const THREAD_HEADER_STATUS_STYLE: Record<
  ThreadHeaderStatusKind,
  { icon: LucideIcon | null; className: string }
> = {
  approval: { icon: ShieldQuestionIcon, className: "bg-warning-surface text-warning-foreground" },
  input: {
    icon: MessageCircleQuestionIcon,
    className: "bg-warning-surface text-warning-foreground",
  },
  paused: { icon: CirclePauseIcon, className: "bg-warning-surface text-warning-foreground" },
  working: { icon: null, className: "bg-primary-surface text-primary-text" },
  monitoring: { icon: EyeIcon, className: "bg-muted text-foreground" },
  failed: { icon: CircleAlertIcon, className: "bg-error-surface text-destructive-foreground" },
  done: { icon: CircleCheckIcon, className: "bg-success/10 text-success-foreground" },
};

function ThreadHeaderStatusPill({
  status,
  plain = false,
}: {
  status: ThreadHeaderStatus;
  /** The focus bar draws the glyph and word without the wash. */
  plain?: boolean;
}) {
  const { icon: Icon, className: styleClassName } = THREAD_HEADER_STATUS_STYLE[status.kind];
  const className = plain
    ? cn(
        "px-0",
        styleClassName
          .split(" ")
          .filter((name) => !name.startsWith("bg-"))
          .join(" "),
      )
    : styleClassName;
  const fullText = joinThreadRowStatus(status);
  // Not a live region itself: it mounts and unmounts with the status, which screen readers
  // skip. ChatHeader keeps an always-mounted region with the short label instead.
  const pill = (
    <span
      className={cn(
        "inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden className="size-3 shrink-0" />
      ) : (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      )}
      <span className="shrink-0">{status.label}</span>
      {status.detail ? (
        <span className="max-w-32 truncate font-normal text-muted-foreground">
          · {status.detail}
        </span>
      ) : null}
    </span>
  );
  if (status.detail === null) return pill;
  // The detail can truncate in the pill; the tooltip keeps it whole.
  return (
    <Tooltip>
      <TooltipTrigger render={pill} />
      <TooltipPopup side="top">{fullText}</TooltipPopup>
    </Tooltip>
  );
}

function ThreadHeaderBranch(props: { branch: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            // Branch gives way first: hidden in narrow headers, pill stays.
            className="hidden min-w-0 shrink rounded-sm bg-surface-well px-1.5 py-[3px] font-mono text-[11px] leading-[14px] text-muted-foreground @xl/header-actions:block"
          />
        }
      >
        <span className="sr-only">Branch </span>
        <span className="block max-w-56 truncate">{props.branch}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{props.branch}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The header's fixed "Changes so far" slot (F5): something bounded to look at
 * while the agent works. It stays in place, disabled as "No changes yet", so
 * the header never shifts when the first file changes.
 */
function ChangesSoFarButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={count === 0}
      onClick={onOpen}
      className="me-1 hidden sm:text-xs @lg/header-actions:inline-flex"
    >
      <FileIcon aria-hidden className="size-3.5" />
      {count === 0
        ? "No changes yet"
        : `Changes so far · ${count} ${count === 1 ? "file" : "files"}`}
    </Button>
  );
}

/** Board 3: the focus bar names a finished turn the way the now bar does, with its times. */
function FocusDoneCue({ workedFor, finishedAt }: { workedFor: string | null; finishedAt: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const summary = doneSummary(workedFor, formatDayAwareTimestamp(finishedAt, timestampFormat));
  return (
    <>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs leading-4 font-medium text-muted-foreground">
        <ListChecksIcon aria-hidden className="size-3.5" />
        Ready to review
      </span>
      <span className="shrink-0 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground tabular-nums">
        {summary.charAt(0).toLowerCase() + summary.slice(1)}
      </span>
    </>
  );
}

function ShortcutKeys({ label }: { label: string | null }) {
  if (!label) return null;
  return <Kbd className="h-5 bg-transparent px-1 ring-1 ring-border">{label}</Kbd>;
}

/**
 * "1 needs you · Next" in the focus bar: the sidebar's Needs you count is
 * hidden in focus, so this pill carries it, and only while another thread is
 * blocked on you.
 */
function FocusNeedsYouPill({
  currentThreadKey,
  keybindings,
}: {
  currentThreadKey: string;
  keybindings: ResolvedKeybindingsConfig;
}) {
  const attention = useThreadAttention();
  const router = useRouter();
  const count = [...attention.blocked, ...attention.earlier].filter(
    (item) => item.key !== currentThreadKey,
  ).length;
  if (count === 0) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.nextNeedsYou");
  return (
    <Button
      size="sm"
      variant="ghost"
      className="shrink-0 bg-warning-surface text-warning-foreground hover:bg-warning-surface hover:text-warning-foreground"
      aria-label={`${count} ${count === 1 ? "thread needs" : "threads need"} you. Go to the next one`}
      onClick={() =>
        goToNextThreadThatNeedsYou({
          attention,
          currentThreadKey,
          navigate: (options) => router.navigate(options),
        })
      }
    >
      {count} needs you
      <span className="text-xs font-normal opacity-85">Next</span>
      <ShortcutKeys label={shortcut} />
    </Button>
  );
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.activeProjectName) return false;
  if (
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  ) {
    return true;
  }
  // Remote environments get the picker in deep-link mode (or its explicit
  // "no SSH route" state). Non-primary local backends (e.g. WSL) keep it
  // hidden, matching pre-remote behavior.
  return input.remoteOpenMode !== "local-exec";
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  isServerThread,
  activeProject,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  changedFileCount,
  nowBarShown = false,
  doneTurn = null,
  onOpenChanges,
  gitCwd,
  onOpenPullRequest,
  onNewThreadInProject,
  onOpenProjectSettings,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  focusMode,
  onToggleFocus,
}: ChatHeaderProps) {
  const isMobile = useIsMobile();
  // Scripts, Open in and Git live in one quiet menu on every viewport; phones get touch rows.
  const menuDensity = isMobile ? "touch" : "default";
  const [actionsOpen, setActionsOpen] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeProjectName = activeProject?.title;
  // The actions menu names the project the way the sidebar and draft hero do;
  // when grouping renames it, the label still says which checkout it is.
  const activeProjectGroupName = useProjectGroupDisplayName(activeProject);
  const projectDisplayName = activeProjectGroupName ?? activeProjectName;
  const projectDetail =
    activeProjectName && projectDisplayName !== activeProjectName
      ? `${projectDisplayName} · ${activeProjectName}`
      : projectDisplayName;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const fileScripts = useE6ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const remoteOpenState = useRemoteOpenState(activeThreadEnvironmentId);
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
    remoteOpenMode: remoteOpenState.mode,
  });
  const showProjectScripts = activeProjectScripts;
  const showGitActions = Boolean(activeProjectName && gitCwd);
  const activeThreadRef = useMemo(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );
  const activeThreadShell = useThreadShell(isServerThread ? activeThreadRef : null);
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Inline rename, keyed by thread: navigating away drops an in-progress
  // rename instead of committing stale text. Cleared on thread change (not
  // just hidden) so returning to the thread doesn't revive the old draft.
  const [renaming, setRenaming] = useState<{ threadId: ThreadId; title: string } | null>(null);
  if (renaming !== null && renaming.threadId !== activeThreadId) {
    setRenaming(null);
  }
  const renamingTitle = renaming?.threadId === activeThreadId ? renaming.title : null;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const headerStatus = activeThreadShell
    ? resolveThreadHeaderStatus(activeThreadShell, (resetsAt) =>
        formatUpcomingTimestamp(resetsAt, timestampFormat),
      )
    : null;
  const headerBranch = activeThreadShell?.branch ?? null;
  const renameCommittedRef = useRef(false);
  const startRename = useCallback(() => {
    renameCommittedRef.current = false;
    setRenaming({ threadId: activeThreadId, title: activeThreadTitle });
  }, [activeThreadId, activeThreadTitle]);
  const commitRename = useCallback(
    (title: string) => {
      setRenaming(null);
      const resolution = resolveRenameCommit({ title, originalTitle: activeThreadTitle });
      if (resolution.action === "reject-empty") {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (resolution.action === "noop") return;
      void updateThreadMetadata({
        environmentId: activeThreadEnvironmentId,
        input: { threadId: activeThreadId, title: resolution.title },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      });
    },
    [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, updateThreadMetadata],
  );
  const { openMenu, closeMenu } = useThreadActionMenu({
    threadRef: isServerThread ? activeThreadRef : null,
    projectCwd: activeProjectCwd,
    onStartRename: startRename,
  });
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const openTitleMenuNow = useCallback(() => {
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  }, [openMenu]);
  const openMenuFromTitle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // The trailing click of a double-click belongs to rename, not the menu.
      if (isTrailingDoubleClick(event.detail)) return;
      openTitleMenuNow();
    },
    [openTitleMenuNow],
  );
  const handleTitleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // The chevron is the explicit menu affordance; only the title text renames.
      if ((event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null) return;
      closeMenu();
      startRename();
    },
    [closeMenu, startRename],
  );
  const handleHeaderContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (renamingTitle !== null) return;
      // The right-side controls (git, scripts, open-in) keep their own
      // behavior; only the breadcrumb area opens the thread menu.
      if ((event.target as HTMLElement).closest("[data-chat-header-actions]")) return;
      if (!isServerThread && onOpenProjectSettings === undefined) return;
      event.preventDefault();
      if (!isServerThread) {
        const api = readLocalApi();
        if (!api) return;
        void api.contextMenu
          .show([{ id: "project-settings", label: "Project settings", icon: "settings" }], {
            x: event.clientX,
            y: event.clientY,
          })
          .then((action) => {
            if (action === "project-settings") onOpenProjectSettings?.();
          });
        return;
      }
      openMenu({ x: event.clientX, y: event.clientY });
    },
    [isServerThread, onOpenProjectSettings, openMenu, renamingTitle],
  );
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        renameCommittedRef.current = true;
        commitRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        renameCommittedRef.current = true;
        setRenaming(null);
      }
    },
    [commitRename],
  );
  const headerActions = (
    <>
      {activeProject ? (
        <>
          <MenuItem density={menuDensity} onClick={onNewThreadInProject}>
            <SquarePenIcon className="size-4" />
            <MenuItemLabel className="truncate">New thread in {projectDetail}</MenuItemLabel>
          </MenuItem>
          {showProjectScripts || showOpenInPicker || showGitActions ? <MenuSeparator /> : null}
        </>
      ) : null}
      {showProjectScripts && (
        <>
          <ProjectScriptsControl
            onRequestMenuClose={() => setActionsOpen(false)}
            presentation="menu"
            menuDensity={menuDensity}
            scripts={showProjectScripts}
            fileScripts={fileScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        </>
      )}
      {showOpenInPicker && (
        <>
          {showProjectScripts && <MenuSeparator />}
          <OpenInPicker
            presentation="menu"
            menuDensity={menuDensity}
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        </>
      )}
      {showGitActions && gitCwd && (
        <>
          {(showProjectScripts || showOpenInPicker) && <MenuSeparator />}
          <GitActionsControl
            presentation="menu"
            menuDensity={menuDensity}
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            onOpenPullRequest={onOpenPullRequest}
            {...(draftId ? { draftId } : {})}
          />
        </>
      )}
    </>
  );
  const hasHeaderActions =
    activeProject !== null || Boolean(showProjectScripts || showOpenInPicker || showGitActions);
  // "More: scripts, open in", naming only what the menu holds here.
  const moreMenuLabel = [
    "More",
    [
      showProjectScripts ? "scripts" : null,
      showOpenInPicker ? "open in" : null,
      showGitActions ? "git" : null,
    ]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join(": ");
  const focusShortcut = shortcutLabelForCommand(keybindings, "focus.toggle");
  const statusRegion = (
    // The open thread's only status live region, so it is heard whether or not the sidebar
    // is showing; the sidebar row of the open thread is not a live region. It stays mounted
    // and holds just the short label, so a status change is announced and a plan step is
    // not. Keyed by thread, so opening a thread does not announce its current status.
    <span key={`${activeThreadEnvironmentId}:${activeThreadId}`} role="status" className="sr-only">
      {headerStatus?.label ?? ""}
    </span>
  );
  if (focusMode) {
    // Board 3: Focus, the title, its status, a Needs you pill only when another thread is
    // blocked, and a visible way out. Escape does not exit.
    return (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs font-medium text-muted-foreground">
          <FocusIcon aria-hidden className="size-3.5" />
          Focus
        </span>
        <h2 className="max-w-80 min-w-0 truncate text-[13px] leading-[18px] font-medium text-foreground">
          {activeThreadTitle}
        </h2>
        {doneTurn ? (
          <FocusDoneCue workedFor={doneTurn.workedFor} finishedAt={doneTurn.finishedAt} />
        ) : headerStatus ? (
          <ThreadHeaderStatusPill status={headerStatus} plain />
        ) : null}
        {statusRegion}
        <span className="grow" />
        {isServerThread ? (
          <FocusNeedsYouPill
            currentThreadKey={scopedThreadKey(activeThreadRef)}
            keybindings={keybindings}
          />
        ) : null}
        <Button size="sm" variant="ghost" className="shrink-0" onClick={onToggleFocus}>
          Exit focus
          <ShortcutKeys label={focusShortcut} />
        </Button>
      </div>
    );
  }
  return (
    <div
      className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
      onContextMenu={handleHeaderContextMenu}
    >
      <WorkspaceBreadcrumb
        ariaLabel="Thread breadcrumb"
        className="flex-1 overflow-clip [overflow-clip-margin:2px]"
      >
        {/* Board 2: "project / title". The project gives way first in narrow headers. */}
        {projectDisplayName ? (
          <>
            <li className="hidden min-w-0 shrink-[2] items-center text-[13px] font-medium text-muted-foreground @2xl/header-actions:flex">
              <span className="truncate">{projectDisplayName}</span>
            </li>
            <WorkspaceBreadcrumbSeparator className="hidden text-muted-foreground @2xl/header-actions:flex" />
          </>
        ) : null}
        {/* The title sizes to its text so the branch sits right after it; the title still
            truncates first, and the status pill holds the right edge. */}
        <WorkspaceBreadcrumbItem current className="min-w-10 shrink text-[15px] font-semibold">
          {renamingTitle !== null ? (
            <input
              autoFocus
              aria-label="Thread title"
              className="min-w-0 flex-1 rounded-sm bg-transparent text-[15px] font-semibold text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring"
              defaultValue={renamingTitle}
              onBlur={(event) => {
                if (renameCommittedRef.current) return;
                commitRename(event.currentTarget.value);
              }}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={handleRenameKeyDown}
            />
          ) : isServerThread ? (
            <div className="group/thread-title inline-flex min-w-0 max-w-full items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      ref={titleButtonRef}
                      type="button"
                      aria-label={`Thread actions for ${activeThreadTitle}`}
                      aria-haspopup="menu"
                      onClick={openMenuFromTitle}
                      onDoubleClick={handleTitleDoubleClick}
                      className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <h2 className="min-w-0">
                    <WorkspaceBreadcrumbText>{activeThreadTitle}</WorkspaceBreadcrumbText>
                  </h2>
                  <ChevronDownIcon
                    aria-hidden
                    data-thread-title-chevron
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-within/thread-title:opacity-100"
                  />
                </TooltipTrigger>
                <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Rename ${activeThreadTitle}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeMenu();
                        startRename();
                      }}
                      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover/thread-title:opacity-100"
                    />
                  }
                >
                  <PencilIcon aria-hidden className="size-3" />
                </TooltipTrigger>
                <TooltipPopup side="top">Rename thread</TooltipPopup>
              </Tooltip>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={<h2 aria-label={activeThreadTitle} className="min-w-0 flex-1" />}
              >
                <WorkspaceBreadcrumbText>{activeThreadTitle}</WorkspaceBreadcrumbText>
              </TooltipTrigger>
              <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
            </Tooltip>
          )}
        </WorkspaceBreadcrumbItem>
        {renamingTitle === null && headerBranch ? (
          <li className="flex min-w-0 shrink items-center">
            <ThreadHeaderBranch branch={headerBranch} />
          </li>
        ) : null}
        {/* The now bar says the same thing in more words (board 2); the live region below
            still announces status changes. */}
        {renamingTitle === null && headerStatus && !nowBarShown ? (
          <li className="ms-auto flex shrink-0 items-center">
            <ThreadHeaderStatusPill status={headerStatus} />
          </li>
        ) : null}
      </WorkspaceBreadcrumb>
      {statusRegion}
      {/* Which machine runs this thread, and whether it is reachable, as a dot and a word.
          Never hidden: narrow headers drop only the machine name. */}
      <EnvironmentConnectionChip environmentId={activeThreadEnvironmentId} />
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end",
          // Reserve two panel toggles plus their 4px gaps and 1px edge inset.
          // The page header adds 8px more right padding at sm.
          rightPanelOpen ? "pr-0" : "pr-[calc(--spacing(18)+1px)] sm:pr-[calc(--spacing(14)+1px)]",
          "[[data-panel-animations=true]_&]:motion-safe:transition-[padding-right] [[data-panel-animations=true]_&]:motion-safe:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:motion-safe:ease-(--ease-spring-gentle)",
        )}
      >
        {changedFileCount !== null ? (
          <ChangesSoFarButton count={changedFileCount} onOpen={onOpenChanges} />
        ) : null}
        {isServerThread ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  className="me-1 hidden sm:text-xs @lg/header-actions:inline-flex"
                  onClick={onToggleFocus}
                />
              }
            >
              <FocusIcon aria-hidden className="size-3.5" />
              Focus
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              One thread, nothing around it{focusShortcut ? ` (${focusShortcut})` : ""}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {/* Scripts, Open in and Git sit in one quiet menu. It stays mounted while closed, so
            their keybindings, command palette entries and open dialogs keep working. */}
        <Menu open={actionsOpen} onOpenChange={setActionsOpen}>
          <MenuTrigger
            className={hasHeaderActions ? undefined : "hidden"}
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label={moreMenuLabel}
              />
            }
          >
            <EllipsisIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup
            data-chat-header-actions
            keepMounted
            aria-label="Thread actions"
            align="end"
            className="min-w-56 max-w-[calc(100vw-2rem)]"
          >
            {headerActions}
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
});
