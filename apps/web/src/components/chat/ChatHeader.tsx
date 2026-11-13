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
  EllipsisIcon,
  FileIcon,
  FocusIcon,
  NotebookPenIcon,
  PanelBottomIcon,
  PencilIcon,
  SquarePenIcon,
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
import { ReadyToReviewStatus } from "./ReadyToReviewStatus";
import { SessionClockCue } from "./SessionClockCue";
import { requestThreadNote, useThreadNoteActionLabel } from "./ThreadRecapCard";
import {
  isTrailingDoubleClick,
  resolveSidebarThreadStatus,
  runningStatusMarkKind,
  THREAD_STATUS_MARKS,
  type ThreadStatusMark,
  type ThreadStatusMarkKind,
} from "../Sidebar.logic";
import { THREAD_STATUS_TONE_TEXT, ThreadStatusMarker } from "../ThreadStatusMarker";
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
import { ShortcutKeyCaps } from "../ShortcutKeyCaps";
import { useRouter } from "@tanstack/react-router";
import { useThreadAttention } from "~/hooks/useThreadAttention";
import { goToNextThreadThatNeedsYou } from "~/lib/needsYouNavigation";
import { shortcutLabelForCommand } from "~/keybindings";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { useUiStateStore } from "~/uiStateStore";

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
  /** Focus mode hides the now bar, so the focus bar offers its Retry for a failed turn. */
  focusRetry?: (() => void) | null;
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
  /** The terminal drawer toggle, in the More menu (board 2 shows only the panel toggle). */
  terminal?: {
    readonly available: boolean;
    readonly open: boolean;
    readonly shortcutLabel: string | null;
    readonly onToggle: () => void;
  } | null;
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

interface ThreadHeaderStatus extends ThreadStatusMark {
  readonly kind: ThreadStatusMarkKind;
  readonly label: string;
  /** Truncatable detail after the label, such as "step 4 of 6". */
  readonly detail: string | null;
}

function headerStatus(
  kind: ThreadStatusMarkKind,
  text: { readonly label: string; readonly detail: string | null },
): ThreadHeaderStatus {
  return { kind, ...text, ...THREAD_STATUS_MARKS[kind] };
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
      return headerStatus("approval", { label: "Needs approval", detail: null });
    case "input":
      return headerStatus("input", { label: "Needs your answer", detail: null });
    case "paused":
    case "working":
      return headerStatus(
        runningStatusMarkKind(status, thread.agentState),
        formatRunningThreadStatus({
          agentState: thread.agentState,
          planProgress: thread.planProgress,
          formatResetTime,
        }),
      );
    case "monitoring":
      return headerStatus("monitoring", { label: "Monitoring", detail: null });
    case "failed":
      return headerStatus("failed", { label: "Failed", detail: null });
    case "ready":
      return thread.latestTurn?.state === "completed"
        ? headerStatus("done", { label: "Done", detail: null })
        : null;
  }
}

// The mark and tone come from the sidebar's status table (THREAD_STATUS_MARKS), so the two
// cannot drift; the pill adds the tone's wash.
const THREAD_HEADER_STATUS_WASH: Record<ThreadStatusMark["tone"], string> = {
  live: "bg-primary-surface",
  warning: "bg-warning-surface",
  muted: "bg-muted",
  success: "bg-success/10",
  failed: "bg-error-surface",
};

function ThreadHeaderStatusPill({
  status,
  plain = false,
}: {
  status: ThreadHeaderStatus;
  /** The focus bar draws the glyph and word without the wash. */
  plain?: boolean;
}) {
  const className = cn(
    THREAD_STATUS_TONE_TEXT[status.tone],
    plain ? "px-0" : THREAD_HEADER_STATUS_WASH[status.tone],
  );
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
      <ThreadStatusMarker kind={status.kind} marker={status.marker} />
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
 * the header never shifts when the first file changes. A narrow header keeps
 * the slot as the file glyph and the count.
 */
function ChangesSoFarButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  const label =
    count === 0 ? "No changes yet" : `Changes so far · ${count} ${count === 1 ? "file" : "files"}`;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={count === 0}
      onClick={onOpen}
      aria-label={label}
      className="me-1 shrink-0 sm:text-xs"
    >
      <FileIcon aria-hidden className="size-3.5" />
      <span aria-hidden className="hidden @lg/header-actions:inline">
        {label}
      </span>
      {count > 0 ? (
        <span aria-hidden className="tabular-nums @lg/header-actions:hidden">
          {count}
        </span>
      ) : null}
    </Button>
  );
}

/**
 * Focus (boards 1 and 2). On the start screen it shows with its key caps but
 * stays disabled: focus mode needs an open thread. A narrow header keeps the
 * glyph alone.
 */
function FocusButton({
  available,
  shortcut,
  onToggle,
}: {
  available: boolean;
  shortcut: string | null;
  onToggle: () => void;
}) {
  const button = (
    <Button
      size="sm"
      variant="outline"
      disabled={!available}
      aria-label="Focus"
      className="me-1 shrink-0 sm:text-xs"
      onClick={onToggle}
    >
      <FocusIcon aria-hidden className="size-3.5" />
      <span aria-hidden className="hidden @lg/header-actions:inline">
        Focus
      </span>
      {available ? null : (
        <ShortcutKeyCaps label={shortcut} className="hidden @lg/header-actions:inline-flex" />
      )}
    </Button>
  );
  return (
    <Tooltip>
      {available ? (
        <TooltipTrigger render={button} />
      ) : (
        // A disabled button gets no pointer events, so the tooltip hangs on its wrapper.
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>{button}</TooltipTrigger>
      )}
      <TooltipPopup side="bottom">
        {available
          ? `One thread, nothing around it${shortcut ? ` (${shortcut})` : ""}`
          : "Focus mode needs an open thread. Send a message first."}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Board 3: the focus bar names a finished turn the way the now bar does, with its times. */
function FocusDoneCue({ workedFor, finishedAt }: { workedFor: string | null; finishedAt: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const summary = doneSummary(workedFor, formatDayAwareTimestamp(finishedAt, timestampFormat));
  return (
    <>
      <ReadyToReviewStatus />
      <span className="shrink-0 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground tabular-nums">
        {summary.charAt(0).toLowerCase() + summary.slice(1)}
      </span>
    </>
  );
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
      className="h-7 shrink-0 rounded-md px-2 text-xs bg-warning-surface text-warning-foreground hover:bg-warning-surface hover:text-warning-foreground sm:h-7 sm:text-xs"
      aria-label={`${count} ${count === 1 ? "thread needs" : "threads need"} you. Go to the next one`}
      onClick={() =>
        goToNextThreadThatNeedsYou({
          attention,
          currentThreadKey,
          // The pill counts blocked threads only; Next walks the same ones.
          scope: "blocked",
          navigate: (options) => router.navigate(options),
        })
      }
    >
      {count} {count === 1 ? "needs" : "need"} you
      <span className="text-xs font-normal opacity-85">Next</span>
      <ShortcutKeyCaps label={shortcut} />
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
  focusRetry = null,
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
  terminal = null,
}: ChatHeaderProps) {
  const isMobile = useIsMobile();
  // Scripts, Open in and the terminal live in one quiet menu; Git has its own slot, except on
  // phones, where it joins the menu. Phones get touch rows.
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
  // The boards draw no Git control in the header, so Git sits in More at every width. It stays
  // mounted there (the menu keeps its popup mounted), so its status refresh and the draft's branch
  // sync keep running. Commit and Push are also in Run details and the Diff's commit rail.
  const gitInMenu = showGitActions;
  const activeThreadRef = useMemo(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );
  const activeThreadShell = useThreadShell(isServerThread ? activeThreadRef : null);
  // "Agent activity" for this thread (F11): its own choice, else the Attention setting.
  const activeThreadKey = scopedThreadKey(activeThreadRef);
  const defaultAgentActivityDetail = useClientSettings((settings) => settings.agentActivityDetail);
  const agentActivityDetail =
    useUiStateStore((state) => state.agentActivityDetailByThreadKey[activeThreadKey]) ??
    defaultAgentActivityDetail;
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
  const noteActionLabel = useThreadNoteActionLabel(isServerThread ? activeThreadKey : null);
  const headerActions = (
    <>
      {activeProject ? (
        <>
          <MenuItem density={menuDensity} onClick={onNewThreadInProject}>
            <SquarePenIcon className="size-4" />
            <MenuItemLabel className="truncate">New thread in {projectDetail}</MenuItemLabel>
          </MenuItem>
          {showProjectScripts || showOpenInPicker || gitInMenu ? <MenuSeparator /> : null}
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
      {gitInMenu && gitCwd && (
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
      {terminal ? (
        <>
          {(activeProject || showProjectScripts || showOpenInPicker || gitInMenu) && (
            <MenuSeparator />
          )}
          <MenuItem
            density={menuDensity}
            disabled={!terminal.available}
            onClick={terminal.onToggle}
          >
            <PanelBottomIcon className="size-4" />
            <MenuItemLabel>{terminal.open ? "Hide terminal" : "Show terminal"}</MenuItemLabel>
            {terminal.shortcutLabel ? <MenuShortcut>{terminal.shortcutLabel}</MenuShortcut> : null}
          </MenuItem>
        </>
      ) : null}
      {isServerThread ? (
        <>
          <MenuSeparator />
          <MenuItem density={menuDensity} onClick={() => requestThreadNote(activeThreadKey)}>
            <NotebookPenIcon className="size-4" />
            <MenuItemLabel>{noteActionLabel}</MenuItemLabel>
          </MenuItem>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>Agent activity</MenuGroupLabel>
            <MenuRadioGroup
              value={agentActivityDetail}
              onValueChange={(value) => {
                if (value !== "summary" && value !== "live") return;
                // Choosing what the setting says clears this thread's own choice.
                useUiStateStore
                  .getState()
                  .setThreadAgentActivityDetail(
                    activeThreadKey,
                    value === defaultAgentActivityDetail ? null : value,
                  );
              }}
            >
              <MenuRadioItem value="summary">Summary</MenuRadioItem>
              <MenuRadioItem value="live">Live</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : null}
    </>
  );
  const hasHeaderActions =
    activeProject !== null ||
    terminal !== null ||
    isServerThread ||
    Boolean(showProjectScripts || showOpenInPicker || gitInMenu);
  // "More: scripts, open in", naming only what the menu holds here.
  const moreMenuLabel = [
    "More",
    [
      showProjectScripts ? "scripts" : null,
      showOpenInPicker ? "open in" : null,
      gitInMenu ? "git" : null,
      terminal ? "terminal" : null,
      isServerThread ? "agent activity" : null,
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
        {focusRetry && headerStatus?.kind === "failed" ? (
          <Button size="sm" variant="outline" className="shrink-0 sm:text-xs" onClick={focusRetry}>
            Retry
          </Button>
        ) : null}
        {statusRegion}
        <span className="grow" />
        <SessionClockCue />
        {isServerThread ? (
          <FocusNeedsYouPill
            currentThreadKey={scopedThreadKey(activeThreadRef)}
            keybindings={keybindings}
          />
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 text-xs sm:text-xs"
          onClick={onToggleFocus}
        >
          Exit focus
          <ShortcutKeyCaps label={focusShortcut} />
        </Button>
      </div>
    );
  }
  return (
    <div
      className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5"
      onContextMenu={handleHeaderContextMenu}
    >
      <WorkspaceBreadcrumb
        ariaLabel="Thread breadcrumb"
        className="group/crumb flex-1 overflow-clip [overflow-clip-margin:2px]"
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
        <WorkspaceBreadcrumbItem current className="min-w-10 shrink text-sm font-semibold">
          {renamingTitle !== null ? (
            <input
              autoFocus
              aria-label="Thread title"
              className="min-w-0 flex-1 rounded-sm bg-transparent text-sm font-semibold text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring"
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
        {/* Rename sits after the branch, so it never holds the title apart from it (board 2);
            it shows on hover and stays reachable by keyboard. */}
        {renamingTitle === null && isServerThread ? (
          <li className="-ms-1 flex shrink-0 items-center sm:-ms-2">
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
                    className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover/crumb:opacity-100 group-focus-within/crumb:opacity-100"
                  />
                }
              >
                <PencilIcon aria-hidden className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">Rename thread</TooltipPopup>
            </Tooltip>
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
      {/* Opt-in session time and break reminder: still, quiet, never focused. */}
      <SessionClockCue />
      {/* Which machine runs this thread, as a dot and a word, only while it is not reachable.
          Narrow headers drop only the machine name. */}
      <EnvironmentConnectionChip environmentId={activeThreadEnvironmentId} />
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end",
          // Reserve the right panel toggle plus its 4px gap and 1px edge inset; the terminal
          // toggle lives in More. The page header adds 8px more right padding at sm.
          rightPanelOpen ? "pr-0" : "pr-[calc(--spacing(9)+1px)] sm:pr-[calc(--spacing(6)+1px)]",
          "[[data-panel-animations=true]_&]:motion-safe:transition-[padding-right] [[data-panel-animations=true]_&]:motion-safe:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:motion-safe:ease-(--ease-spring-gentle)",
        )}
      >
        {changedFileCount !== null ? (
          <ChangesSoFarButton count={changedFileCount} onOpen={onOpenChanges} />
        ) : null}
        <FocusButton available={isServerThread} shortcut={focusShortcut} onToggle={onToggleFocus} />
        {/* Scripts, Open in and the terminal sit in one quiet menu. It stays mounted while closed, so
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
