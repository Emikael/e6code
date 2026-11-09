import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@e6tools/contracts";
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
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
  CircleDashedIcon,
  CirclePauseIcon,
  EllipsisIcon,
  EyeIcon,
  GitBranchIcon,
  MessageCircleQuestionIcon,
  PencilIcon,
  ShieldQuestionIcon,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
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
import { formatUpcomingTimestamp } from "~/timestampFormat";
import { useAtomCommand } from "../../state/use-atom-command";
import { observeResponsiveBreakpointFade, usePanelAnimationSettings } from "../../panelAnimations";
import { EnvironmentConnectionChip } from "../EnvironmentConnectionChip";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

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
  /** The Inspector's Overview shows these actions, so the header leaves them out. */
  workspaceActionsInPanel?: boolean;
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
 * of 6", "Paused · resets 14:20"), with full wording for attention states
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

// Same icons and semantic hues as the sidebar row status.
const THREAD_HEADER_STATUS_STYLE: Record<
  ThreadHeaderStatusKind,
  { icon: LucideIcon; className: string }
> = {
  approval: { icon: ShieldQuestionIcon, className: "text-warning-foreground" },
  input: { icon: MessageCircleQuestionIcon, className: "text-primary-text" },
  paused: { icon: CirclePauseIcon, className: "text-warning-foreground" },
  working: { icon: CircleDashedIcon, className: "text-info-foreground" },
  monitoring: { icon: EyeIcon, className: "text-foreground" },
  failed: { icon: CircleAlertIcon, className: "text-destructive-foreground" },
  done: { icon: CircleCheckIcon, className: "text-success-foreground" },
};

function ThreadHeaderStatusPill({ status }: { status: ThreadHeaderStatus }) {
  const { icon: Icon, className } = THREAD_HEADER_STATUS_STYLE[status.kind];
  const fullText = joinThreadRowStatus(status);
  // Not a live region: the open thread's sidebar row already announces its status label,
  // so a second region here read every change twice. The pill also mounts with its first
  // status, which screen readers skip in a freshly inserted live region anyway.
  const pill = (
    <span
      className={cn(
        "inline-flex h-5 min-w-0 max-w-full items-center gap-1 rounded-full border border-border px-1.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
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
            className="hidden min-w-0 shrink items-center gap-1 text-xs text-muted-foreground @xl/header-actions:inline-flex"
          />
        }
      >
        <GitBranchIcon aria-hidden className="size-3 shrink-0" />
        <span className="max-w-40 truncate font-mono">{props.branch}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{props.branch}</TooltipPopup>
    </Tooltip>
  );
}

// Matches the @3xl/header-actions container breakpoint owned by this header.
const HEADER_ACTIONS_EXPANDED_BREAKPOINT_REM = 48;

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
  workspaceActionsInPanel = false,
  gitCwd,
  onOpenPullRequest,
  onNewThreadInProject,
  onOpenProjectSettings,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const headerActionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const actions = headerActionsRef.current;
    const container = actions?.parentElement;
    if (!actions || !container) return;
    return observeResponsiveBreakpointFade({
      target: actions,
      container,
      active: panelAnimationsActive,
      durationMs: panelAnimationDurationMs,
      breakpoint: { value: HEADER_ACTIONS_EXPANDED_BREAKPOINT_REM, unit: "rem" },
    });
  }, [panelAnimationDurationMs, panelAnimationsActive]);
  const isMobile = useIsMobile();
  // Side panels can leave a desktop header narrower than a phone.
  const [isNarrowHeader, setIsNarrowHeader] = useState(false);
  useEffect(() => {
    const container = headerActionsRef.current?.parentElement;
    if (!container) return;
    const update = () => setIsNarrowHeader(container.clientWidth < 512);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const actionsCollapsed = isMobile || isNarrowHeader;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsContainer] = useState(() => {
    const container = document.createElement("div");
    container.className = "contents";
    return container;
  });
  // Reparent the DOM host, not the React controls: rotating a phone or resizing
  // a window must not discard an unsaved script or Git dialog.
  const mountInlineActions = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && !actionsCollapsed) node.appendChild(actionsContainer);
    },
    [actionsContainer, actionsCollapsed],
  );
  const mountMenuActions = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && actionsCollapsed) node.appendChild(actionsContainer);
    },
    [actionsContainer, actionsCollapsed],
  );
  if (!actionsCollapsed && actionsOpen) setActionsOpen(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeProjectName = activeProject?.title;
  // The breadcrumb names the project the way the sidebar and draft hero do;
  // when grouping renames it, the tooltip still says which checkout it is.
  const activeProjectGroupName = useProjectGroupDisplayName(activeProject);
  const breadcrumbProjectName = activeProjectGroupName ?? activeProjectName;
  const breadcrumbProjectDetail =
    activeProjectName && breadcrumbProjectName !== activeProjectName
      ? `${breadcrumbProjectName} · ${activeProjectName}`
      : breadcrumbProjectName;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const fileScripts = useE6ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const remoteOpenState = useRemoteOpenState(activeThreadEnvironmentId);
  const showOpenInPicker =
    !workspaceActionsInPanel &&
    shouldShowOpenInPicker({
      activeProjectName,
      activeThreadEnvironmentId,
      primaryEnvironmentId,
      remoteOpenMode: remoteOpenState.mode,
    });
  const showProjectScripts = workspaceActionsInPanel ? undefined : activeProjectScripts;
  const showGitActions = !workspaceActionsInPanel && Boolean(activeProjectName && gitCwd);
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
  const showThreadStatus =
    renamingTitle === null && (headerStatus !== null || headerBranch !== null);
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
      {showProjectScripts && (
        <>
          <ProjectScriptsControl
            onRequestMenuClose={() => setActionsOpen(false)}
            presentation={actionsCollapsed ? "menu" : "toolbar"}
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
          {actionsCollapsed && showProjectScripts && <MenuSeparator />}
          <OpenInPicker
            presentation={actionsCollapsed ? "menu" : "toolbar"}
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        </>
      )}
      {showGitActions && gitCwd && (
        <>
          {actionsCollapsed && (showProjectScripts || showOpenInPicker) && <MenuSeparator />}
          <GitActionsControl
            presentation={actionsCollapsed ? "menu" : "toolbar"}
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            onOpenPullRequest={onOpenPullRequest}
            {...(draftId ? { draftId } : {})}
          />
        </>
      )}
    </>
  );
  return (
    <div
      className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
      onContextMenu={handleHeaderContextMenu}
    >
      <WorkspaceBreadcrumb
        ariaLabel="Thread breadcrumb"
        className="flex-1 overflow-clip [overflow-clip-margin:2px]"
      >
        {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
        {activeProject ? (
          <>
            <WorkspaceBreadcrumbItem className="shrink">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`New thread in ${breadcrumbProjectDetail}`}
                      onClick={onNewThreadInProject}
                      className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <ProjectFavicon project={activeProject} className="size-3.5" />
                  <WorkspaceBreadcrumbText className="max-w-40">
                    {breadcrumbProjectName}
                  </WorkspaceBreadcrumbText>
                </TooltipTrigger>
                <TooltipPopup side="top">New thread in {breadcrumbProjectDetail}</TooltipPopup>
              </Tooltip>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator>
              <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
            </WorkspaceBreadcrumbSeparator>
          </>
        ) : null}
        {/* With status beside it, the title sizes to its text so the pill
            sits right after it; the title still truncates first. */}
        <WorkspaceBreadcrumbItem
          current
          className={cn("min-w-10", showThreadStatus ? "shrink" : "flex-1")}
        >
          {renamingTitle !== null ? (
            <input
              autoFocus
              aria-label="Thread title"
              className="min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring"
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
        {showThreadStatus ? (
          <li className="flex shrink-0 items-center gap-2">
            {headerStatus ? <ThreadHeaderStatusPill status={headerStatus} /> : null}
            {headerBranch ? <ThreadHeaderBranch branch={headerBranch} /> : null}
          </li>
        ) : null}
      </WorkspaceBreadcrumb>
      {/* Which machine runs this thread, and whether it is reachable, in words. */}
      <EnvironmentConnectionChip
        environmentId={activeThreadEnvironmentId}
        className="hidden @2xl/header-actions:inline-flex"
      />
      <div
        ref={headerActionsRef}
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          // Reserve two panel toggles plus their 4px gaps and 1px edge inset.
          // The page header adds 8px more right padding at sm.
          rightPanelOpen ? "pr-0" : "pr-[calc(--spacing(18)+1px)] sm:pr-[calc(--spacing(14)+1px)]",
          "[[data-panel-animations=true]_&]:motion-safe:transition-[padding-right] [[data-panel-animations=true]_&]:motion-safe:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:motion-safe:ease-(--ease-spring-gentle)",
        )}
      >
        <Menu open={actionsCollapsed && actionsOpen} onOpenChange={setActionsOpen}>
          <MenuTrigger
            className={
              actionsCollapsed && (showProjectScripts || showOpenInPicker || showGitActions)
                ? undefined
                : "hidden"
            }
            render={<Button size="icon-sm" variant="ghost" aria-label="More header actions" />}
          >
            <EllipsisIcon className="size-4" />
          </MenuTrigger>
          <div ref={mountInlineActions} className="contents" />
          <MenuPopup
            data-chat-header-actions
            keepMounted
            aria-label="Header actions"
            align="end"
            className="min-w-56 max-w-[calc(100vw-2rem)]"
            finalFocus={actionsCollapsed ? undefined : false}
          >
            <div ref={mountMenuActions} className="contents" />
            {createPortal(headerActions, actionsContainer)}
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
});
