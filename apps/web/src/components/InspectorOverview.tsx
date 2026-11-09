/**
 * Inspector Overview: the right panel's first surface. Workspace actions,
 * source control at a glance, and the lineage of every subagent this thread
 * spawned, with the selected one shown in detail.
 *
 * Visualization rules (carried over from the Agents surface it replaces):
 * - Spawn order is stable. Activity and completion update rows in place;
 *   finished rows fold only when the panel opens, never under the pointer.
 * - Status is a glyph plus a word or label, never color alone.
 * - Stop ends one live subagent, not the turn. It shows its pending state on
 *   the control until the provider confirms, and a failure arrives as a toast.
 * - Elapsed timers tick by DOM writes; nothing repaints continuously.
 * - The panel sits on the sidebar ground, so metadata uses the sidebar's
 *   muted role, which every theme tunes for that ground.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EditorId,
  EnvironmentId,
  ProjectScript,
  ProviderDriverKind,
  ResolvedKeybindingsConfig,
  ThreadId,
  TurnId,
} from "@e6tools/contracts";
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentProject } from "@e6tools/client-runtime/state/shell";
import {
  type AgentPanelModel,
  type AgentPanelWorkflowGroup,
  formatSubagentFileCount,
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  type RuntimeSubagent,
  type SubagentChangedFiles,
  SUBAGENT_FILES_PREVIEW_LIMIT,
  SUBAGENT_STATUS_LABEL,
  isSubagentWaitingTone,
  subagentActivityText,
  subagentTone,
  summarizeSubagentStatuses,
} from "@e6tools/client-runtime/state/subagentRuntime";
import { describeSubagentUserRequest } from "@e6tools/client-runtime/pending-requests";
import {
  type ContextWindowSnapshot,
  describeContextWindowUsage,
} from "@e6tools/client-runtime/work-log/context-window";
import { fileBasename, workspaceRelativeFilePath } from "@e6tools/client-runtime/markdown-links";
import {
  BotIcon,
  BracesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleStopIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GaugeIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  MessageSquareTextIcon,
  MonitorIcon,
  RefreshCwIcon,
  SquareArrowOutUpRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DraftId } from "~/composerDraftStore";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useE6ProjectFileScripts } from "~/hooks/useE6ProjectFileScripts";
import { cn } from "~/lib/utils";
import { primaryProjectScript } from "~/projectScripts";
import { useRemoteOpenState } from "~/remoteOpen";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { useSubagentSelectionStore } from "~/subagentSelectionStore";
import GitActionsControl from "./GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "./ProjectScriptsControl";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { OpenInPicker } from "./chat/OpenInPicker";
import { shouldShowOpenInPicker } from "./chat/ChatHeader";
import {
  SUBAGENT_TONE_TEXT_CLASS,
  SubagentElapsed,
  SubagentStatusGlyph,
  SubagentTile,
} from "./subagents/SubagentParts";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "./ui/menu";
import { ScrollArea } from "./ui/scroll-area";
import { toastManager } from "./ui/toast";

export interface InspectorWorkspace {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId | undefined;
  activeProject: EnvironmentProject | null;
  openInCwd: string | null;
  gitCwd: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  /**
   * The project's setup script, when the thread runs in a worktree. `changed`
   * means the worktree was set up with an older version of it.
   */
  worktreeSetup: { readonly script: ProjectScript; readonly changed: boolean } | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  onOpenPullRequest?: ((number: number) => void) | undefined;
  /** Opens the Diff surface; null when the thread has no diff to show. */
  onOpenDiff: (() => void) | null;
  /** Opens one turn's diff, optionally at a file; null when there is none to show. */
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
}

/** Stopping one subagent; null when the thread offers no Stop at all. */
export interface InspectorSubagentStop {
  /** Live, on a provider that can stop one subagent, and not a workflow member. */
  readonly canStop: (agent: RuntimeSubagent) => boolean;
  readonly isPending: (agentId: string) => boolean;
  readonly stop: (agentId: string) => void;
  readonly shortcutLabel: string | null;
}

const MUTED = "text-sidebar-muted-foreground";
const ROW_CLASS_NAME =
  "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent/60";
const ROW_ICON_CLASS_NAME = cn("size-4 shrink-0", MUTED);

/** A row that opens one of the header's controls in its menu presentation. */
function InspectorMenuRow({
  icon,
  label,
  meta,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger className={ROW_CLASS_NAME}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta}
        <ChevronDownIcon aria-hidden className={cn("size-3 shrink-0", MUTED)} />
      </MenuTrigger>
      {/* Kept mounted so dialogs the control opens outlive the menu. */}
      <MenuPopup keepMounted align="end" className="min-w-56 max-w-[calc(100vw-2rem)]">
        {children(close)}
      </MenuPopup>
    </Menu>
  );
}

function SectionDivider() {
  return <div aria-hidden className="mx-2 my-2 h-px bg-sidebar-border" />;
}

function WorkspaceSection({ workspace }: { workspace: InspectorWorkspace }) {
  const project = workspace.activeProject;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const remoteOpenState = useRemoteOpenState(workspace.environmentId);
  const fileScripts = useE6ProjectFileScripts(
    workspace.environmentId,
    workspace.activeProjectScripts ? (project?.workspaceRoot ?? null) : null,
  );
  const showOpenIn = shouldShowOpenInPicker({
    activeProjectName: project?.title,
    activeThreadEnvironmentId: workspace.environmentId,
    primaryEnvironmentId,
    remoteOpenMode: remoteOpenState.mode,
  });
  const scripts = workspace.activeProjectScripts;
  // Same choice as the header's script button: the last run, else the first
  // script that is not a worktree setup step.
  const scriptLabel =
    scripts?.find((script) => script.id === workspace.preferredScriptId)?.name ??
    (scripts ? primaryProjectScript(scripts)?.name : undefined) ??
    "Scripts";

  if (!project) return null;
  return (
    <div role="group" aria-label="Workspace" className="flex flex-col">
      <div className="flex h-8 min-w-0 items-center gap-2.5 px-2">
        <MonitorIcon aria-hidden className={ROW_ICON_CLASS_NAME} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{project.title}</span>
      </div>
      {showOpenIn ? (
        <InspectorMenuRow
          icon={<SquareArrowOutUpRightIcon aria-hidden className={ROW_ICON_CLASS_NAME} />}
          label="Open in editor"
        >
          {() => (
            <OpenInPicker
              presentation="menu"
              enableShortcut={false}
              environmentId={workspace.environmentId}
              keybindings={workspace.keybindings}
              availableEditors={workspace.availableEditors}
              openInCwd={workspace.openInCwd}
            />
          )}
        </InspectorMenuRow>
      ) : null}
      {scripts ? (
        <InspectorMenuRow
          icon={<WrenchIcon aria-hidden className={ROW_ICON_CLASS_NAME} />}
          label={scriptLabel}
        >
          {(close) => (
            <ProjectScriptsControl
              presentation="menu"
              onRequestMenuClose={close}
              scripts={scripts}
              fileScripts={fileScripts}
              keybindings={workspace.keybindings}
              preferredScriptId={workspace.preferredScriptId}
              onRunScript={workspace.onRunProjectScript}
              onAddScript={workspace.onAddProjectScript}
              onUpdateScript={workspace.onUpdateProjectScript}
              onDeleteScript={workspace.onDeleteProjectScript}
            />
          )}
        </InspectorMenuRow>
      ) : null}
      {workspace.worktreeSetup ? <WorktreeSetupRow workspace={workspace} /> : null}
      <SectionDivider />
    </div>
  );
}

/**
 * Re-runs the setup script in the thread's worktree. When it exits cleanly the
 * server records the current script on the thread, which clears the Changed
 * badge; a failed run leaves it.
 */
function WorktreeSetupRow({ workspace }: { workspace: InspectorWorkspace }) {
  const setup = workspace.worktreeSetup;
  if (!setup) return null;
  return (
    <button
      type="button"
      className={ROW_CLASS_NAME}
      onClick={() => workspace.onRunProjectScript(setup.script)}
    >
      <RefreshCwIcon aria-hidden className={ROW_ICON_CLASS_NAME} />
      <span className="min-w-0 flex-1 truncate">Setup worktree</span>
      {setup.changed ? (
        <span className="shrink-0 rounded-sm bg-warning-surface px-1.5 py-px text-[11px] font-medium text-warning-foreground">
          Changed
          <span className="sr-only"> since this worktree ran it</span>
        </span>
      ) : (
        <span className={cn("text-xs", MUTED)}>Run again</span>
      )}
    </button>
  );
}

/** Branch, commit and change count. Values stay blank until status arrives. */
function SourceControlSection({
  workspace,
  gitCwd,
}: {
  workspace: InspectorWorkspace;
  gitCwd: string;
}) {
  const { data: status } = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: workspace.environmentId, input: { cwd: gitCwd } }),
  );
  if (status && !status.isRepo) return null;
  const files = status?.workingTree.files.length ?? 0;
  const ahead = status?.aheadCount ?? 0;
  const behind = status?.behindCount ?? 0;
  const threadRef = scopeThreadRef(workspace.environmentId, workspace.threadId);
  const commitMeta = !status
    ? null
    : files > 0
      ? `${files} ${files === 1 ? "file" : "files"}`
      : ahead > 0
        ? `${ahead} to push`
        : "Nothing to commit";
  const changes = status ? (
    <>
      <span className="text-xs tabular-nums text-success-foreground">
        +{status.workingTree.insertions}
      </span>
      <span className="text-xs tabular-nums text-destructive-foreground">
        −{status.workingTree.deletions}
      </span>
    </>
  ) : null;
  return (
    <div role="group" aria-label="Source control" className="flex flex-col">
      <div className="flex h-8 min-w-0 items-center gap-2.5 px-2">
        <GitBranchIcon aria-hidden className={ROW_ICON_CLASS_NAME} />
        <span className={cn("min-w-0 flex-1 truncate text-xs", status ? "font-mono" : MUTED)}>
          {status ? (status.refName ?? "Detached") : "Checking…"}
        </span>
        {ahead > 0 ? (
          <span className={cn("text-xs tabular-nums", MUTED)}>
            ↑{ahead}
            <span className="sr-only"> ahead</span>
          </span>
        ) : null}
        {behind > 0 ? (
          <span className={cn("text-xs tabular-nums", MUTED)}>
            ↓{behind}
            <span className="sr-only"> behind</span>
          </span>
        ) : null}
      </div>
      <InspectorMenuRow
        icon={<GitCommitHorizontalIcon aria-hidden className={ROW_ICON_CLASS_NAME} />}
        label="Commit"
        meta={commitMeta ? <span className={cn("text-xs", MUTED)}>{commitMeta}</span> : null}
      >
        {() => (
          <GitActionsControl
            presentation="menu"
            gitCwd={gitCwd}
            activeThreadRef={threadRef}
            onOpenPullRequest={workspace.onOpenPullRequest}
            {...(workspace.draftId ? { draftId: workspace.draftId } : {})}
          />
        )}
      </InspectorMenuRow>
      {workspace.onOpenDiff ? (
        <button type="button" className={ROW_CLASS_NAME} onClick={workspace.onOpenDiff}>
          <FileDiffIcon aria-hidden className={ROW_ICON_CLASS_NAME} />
          <span className="min-w-0 flex-1 truncate">Changes</span>
          {changes}
        </button>
      ) : (
        <div className="flex h-8 min-w-0 items-center gap-2.5 px-2 text-[13px]">
          <FileDiffIcon aria-hidden className={ROW_ICON_CLASS_NAME} />
          <span className="min-w-0 flex-1 truncate">Changes</span>
          {changes}
        </div>
      )}
      <SectionDivider />
    </div>
  );
}

/**
 * How full the thread's context window is, from the latest usage the provider
 * reported. Providers that report none never render this section. The bar is
 * static: it moves only when a new snapshot arrives.
 */
function ContextSection({ snapshot }: { snapshot: ContextWindowSnapshot }) {
  const usage = describeContextWindowUsage(snapshot);
  return (
    <div role="group" aria-label="Context" className="flex flex-col">
      <div className="flex h-8 min-w-0 items-center gap-2.5 px-2 text-[13px]">
        <GaugeIcon aria-hidden className={ROW_ICON_CLASS_NAME} />
        <span className="shrink-0">Context</span>
        <span className={cn("min-w-0 flex-1 truncate text-right text-xs tabular-nums", MUTED)}>
          {usage.label}
        </span>
      </div>
      {usage.percent !== null ? (
        <div
          role="meter"
          aria-label="Context window usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usage.percent}
          aria-valuetext={usage.label}
          className="mr-2 mb-1 ml-[34px] h-1 overflow-hidden rounded-full bg-sidebar-muted-foreground/20"
        >
          <div
            className={cn(
              "h-full rounded-full",
              usage.warning ? "bg-warning" : "bg-sidebar-muted-foreground/70",
            )}
            style={{ width: `${usage.percent}%` }}
          />
        </div>
      ) : null}
      {usage.compactionNote ? (
        <p className={cn("mr-2 ml-[34px] pt-1 text-xs", MUTED)}>{usage.compactionNote}</p>
      ) : null}
      <SectionDivider />
    </div>
  );
}

/**
 * Read-only workflow script viewer, fetched through the contained
 * getWorkflowScript RPC (never a raw filesystem read from the client).
 */
function WorkflowScriptView({
  environmentId,
  threadId,
  scriptPath,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  scriptPath: string;
  onClose: () => void;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.workflowScript({ environmentId, input: { threadId, scriptPath } }),
  );
  return (
    <div className="rounded-lg border border-border bg-surface-well">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <BracesIcon aria-hidden className="size-3 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-muted-foreground">
          {scriptPath.split("/").at(-1)}
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onClose}
          aria-label="Close script"
          className="ml-auto"
        >
          <XIcon aria-hidden className="size-3" />
        </Button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {result._tag === "Success" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
            {result.value.contents}
            {result.value.truncated ? "\n… (truncated)" : ""}
          </pre>
        ) : result._tag === "Failure" ? (
          <p className="text-xs text-destructive-foreground">Could not load the script.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </div>
    </div>
  );
}

type LineagePhase = AgentPanelWorkflowGroup["phases"][number];

interface LineageNode {
  readonly agent: RuntimeSubagent;
  /** Workflow members by phase, in phase order; empty for a direct spawn. */
  readonly phases: ReadonlyArray<LineagePhase>;
  readonly unphased: ReadonlyArray<RuntimeSubagent>;
}

/** Top-level lineage in spawn order: workflows carry their members. */
function deriveLineage(model: AgentPanelModel): ReadonlyArray<LineageNode> {
  const nodes: LineageNode[] = [
    ...model.workflows.map((group) => ({
      agent: group.workflow,
      phases: group.phases,
      unphased: group.unphasedMembers,
    })),
    ...model.directAgents.map((agent) => ({ agent, phases: [], unphased: [] })),
  ];
  return nodes.sort(
    (a, b) =>
      a.agent.firstSeenAt.localeCompare(b.agent.firstSeenAt) ||
      a.agent.id.localeCompare(b.agent.id),
  );
}

function nodeMembers(node: LineageNode): ReadonlyArray<RuntimeSubagent> {
  return [...node.phases.flatMap((phase) => phase.members), ...node.unphased];
}

const PHASE_STATE_WORD: Readonly<Record<LineagePhase["state"], string>> = {
  pending: "Pending",
  running: "Working",
  done: "Done",
};

/**
 * One subagent in the lineage. Hover or focus trades the elapsed time for a
 * menu with the ways back out: the thread card, the task text and the session,
 * and Stop while it runs.
 */
function LineageRow({
  agent,
  providerKind,
  selected,
  onSelect,
  onShowInThread,
  stopControl,
}: {
  agent: RuntimeSubagent;
  providerKind: ProviderDriverKind | null;
  selected: boolean;
  onSelect: (agentId: string) => void;
  onShowInThread: ((agentId: string) => void) | null;
  stopControl: InspectorSubagentStop | null;
}) {
  const tone = subagentTone(agent);
  const canStop = stopControl?.canStop(agent) === true;
  const stopPending = canStop && stopControl.isPending(agent.id);
  const sessionUrl = agent.runHandles?.sessionUrl;
  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () =>
      toastManager.add({ type: "success", title: "Task copied", description: agent.title }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Couldn't copy the task",
        description: error.message,
      }),
  });
  return (
    <div className="group/lineage relative flex min-w-0">
      <button
        type="button"
        data-lineage-row
        data-agent-id={agent.id}
        aria-current={selected ? "true" : undefined}
        aria-label={`${agent.title}, ${SUBAGENT_STATUS_LABEL[tone]}`}
        onClick={() => onSelect(agent.id)}
        className={cn(
          "flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          // Selection takes the primary edge, the system's selected-outline role.
          selected
            ? "bg-accent ring-1 ring-inset ring-primary-edge"
            : "group-hover/lineage:bg-accent/60",
        )}
      >
        <SubagentTile driverKind={providerKind} size="sm" />
        <span className="min-w-0 flex-1 truncate">{agent.title}</span>
        <SubagentStatusGlyph tone={tone} decorative />
        <SubagentElapsed
          agent={agent}
          className={cn(
            "min-w-14 shrink-0 text-right text-xs group-focus-within/lineage:invisible group-hover/lineage:invisible group-has-[[data-popup-open]]/lineage:invisible",
            MUTED,
          )}
        />
      </button>
      <Menu>
        <MenuTrigger
          aria-label={`More for ${agent.title}`}
          className={cn(
            "absolute inset-y-0.5 end-0.5 inline-flex w-7 items-center justify-center rounded-[5px] opacity-0 outline-none transition-colors hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-focus-within/lineage:opacity-100 group-hover/lineage:opacity-100 data-popup-open:bg-accent data-popup-open:opacity-100 pointer-coarse:opacity-100",
            MUTED,
          )}
        >
          <EllipsisIcon aria-hidden className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-44">
          {onShowInThread ? (
            <MenuItem onClick={() => onShowInThread(agent.id)}>
              <MessageSquareTextIcon aria-hidden />
              Show in thread
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => copyToClipboard(agent.title)}>
            <CopyIcon aria-hidden />
            Copy task
          </MenuItem>
          {sessionUrl ? (
            <MenuItem render={<a href={sessionUrl} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon aria-hidden />
              Open session
            </MenuItem>
          ) : null}
          {canStop ? (
            <>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={stopPending}
                onClick={() => stopControl.stop(agent.id)}
              >
                <CircleStopIcon aria-hidden />
                {stopPending ? "Stopping…" : "Stop subagent"}
                {/* The shortcut stops the selected subagent, so only its menu names it. */}
                {selected && stopControl.shortcutLabel && !stopPending ? (
                  <MenuShortcut className="ms-auto">{stopControl.shortcutLabel}</MenuShortcut>
                ) : null}
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </div>
  );
}

function moveLineageFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-lineage-row]"),
  );
  const index = rows.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  rows[
    Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))
  ]?.focus();
}

/**
 * The files a subagent's edits changed. Each opens the diff of the turn that
 * last touched it, at that file; counts appear only where the provider gave them.
 */
function SubagentFilesSection({
  changedFiles,
  workspaceRoot,
  onOpenTurnDiff,
}: {
  changedFiles: SubagentChangedFiles;
  workspaceRoot: string | null;
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const { files, additions, deletions } = changedFiles;
  const visible = showAll ? files : files.slice(0, SUBAGENT_FILES_PREVIEW_LIMIT);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-semibold">Files</span>
        <span>{formatSubagentFileCount(files.length)}</span>
        {additions !== null && deletions !== null ? (
          <DiffStatLabel additions={additions} deletions={deletions} layout="inline" />
        ) : null}
      </span>
      <ul className="-mx-1 flex flex-col">
        {visible.map((file) => {
          const path = workspaceRelativeFilePath(file.path, workspaceRoot) ?? file.path;
          const name = fileBasename(path);
          const directory = path.length > name.length ? path.slice(0, -name.length - 1) : "";
          const content = (
            <>
              {/* Name and folder both give way; only the counts keep their width. */}
              <span className="min-w-0 truncate font-mono text-[11px]">{name}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {directory}
              </span>
              {file.additions !== null && file.deletions !== null ? (
                <DiffStatLabel
                  additions={file.additions}
                  deletions={file.deletions}
                  layout="inline"
                  className="shrink-0 text-[11px]"
                />
              ) : null}
            </>
          );
          const turnId = file.turnId;
          return (
            <li key={file.path}>
              {onOpenTurnDiff && turnId ? (
                <button
                  type="button"
                  aria-label={`Open diff of ${path}`}
                  onClick={() => onOpenTurnDiff(turnId, path)}
                  className="flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <div className="flex h-6 min-w-0 items-center gap-2 px-1">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {files.length > SUBAGENT_FILES_PREVIEW_LIMIT ? (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="self-start rounded-md text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAll ? "Show fewer" : `Show ${files.length - SUBAGENT_FILES_PREVIEW_LIMIT} more`}
        </button>
      ) : null}
    </div>
  );
}

function SubagentDetailCard({
  agent,
  providerKind,
  environmentId,
  threadId,
  workspaceRoot,
  onOpenTurnDiff,
  cardRef,
  stopControl,
}: {
  agent: RuntimeSubagent;
  providerKind: ProviderDriverKind | null;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  workspaceRoot: string | null;
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
  cardRef: Ref<HTMLDivElement>;
  stopControl: InspectorSubagentStop | null;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const canStop = stopControl?.canStop(agent) === true;
  const stopPending = canStop && stopControl.isPending(agent.id);
  const tone = subagentTone(agent);
  const live = isActiveSubagentStatus(agent.status);
  const modelLabel = formatSubagentModelLabel(agent.model, agent.effort);
  const role =
    agent.role && agent.role.trim().toLowerCase() !== agent.title.trim().toLowerCase()
      ? agent.role
      : null;
  const request = agent.waitingOn ? describeSubagentUserRequest(agent.waitingOn) : null;
  const activity = agent.waitingOn
    ? agent.waitingOn.kind === "approval"
      ? "Waiting for your approval in the composer."
      : "Waiting for your answer in the composer."
    : live
      ? (agent.progress ?? subagentActivityText(agent))
      : (agent.error ?? agent.result ?? subagentActivityText(agent));
  const scriptPath = agent.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  const sessionUrl = agent.runHandles?.sessionUrl;
  // "Recent" adds history, so it never repeats what "Now" already says.
  const recent = agent.recentActivity
    .filter((entry) => entry.summary !== activity)
    .slice(-4)
    .toReversed();

  return (
    <div
      ref={cardRef}
      role="group"
      aria-label={`${agent.title} details`}
      className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-card px-2 py-3 text-card-foreground shadow-xs"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <SubagentTile driverKind={providerKind} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold">{agent.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {[role, modelLabel].filter(Boolean).join(" · ") || "Subagent"}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold",
            // The warning word needs its own surface to stay readable in every theme.
            isSubagentWaitingTone(tone) ? "bg-warning-surface" : "bg-accent",
            SUBAGENT_TONE_TEXT_CLASS[tone],
          )}
        >
          <SubagentStatusGlyph tone={tone} className="size-3" decorative />
          {SUBAGENT_STATUS_LABEL[tone]}
        </span>
      </div>
      {activity ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">
            {live ? "Now" : agent.status === "failed" ? "Error" : "Result"}
          </span>
          <p
            className={cn(
              "line-clamp-6 whitespace-pre-wrap break-words text-xs leading-relaxed",
              agent.status === "failed" && "text-destructive-foreground",
            )}
          >
            {request ? (
              <>
                {request.text}
                {request.code ? (
                  <>
                    {" "}
                    <code className="break-all font-mono text-[11px]">{request.code}</code>
                  </>
                ) : null}
                <span className={cn("block", MUTED)}>{activity}</span>
              </>
            ) : (
              activity
            )}
          </p>
        </div>
      ) : null}
      {recent.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">Recent</span>
          <ul className="flex flex-col gap-0.5">
            {recent.map((entry) => (
              <li
                key={`${entry.at}:${entry.summary}`}
                className="truncate text-xs text-muted-foreground"
              >
                {entry.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="grid grid-cols-3 gap-2 border-t border-border pt-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Elapsed</dt>
          <dd className="text-[13px] font-medium">
            <SubagentElapsed agent={agent} />
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Tokens</dt>
          <dd className="text-[13px] font-medium tabular-nums">
            {agent.usage ? formatSubagentTokenCount(agent.usage.totalTokens) : "–"}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Tool calls</dt>
          <dd className="text-[13px] font-medium tabular-nums">
            {agent.usage?.toolUses ?? "–"}
            {agent.activationCount > 1 ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · run {agent.activationCount}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      {canShowScript || sessionUrl || canStop ? (
        <div className="flex gap-2">
          {canShowScript ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              aria-expanded={scriptOpen}
              onClick={() => setScriptOpen((value) => !value)}
            >
              <BracesIcon aria-hidden />
              {scriptOpen ? "Hide script" : "Show script"}
            </Button>
          ) : null}
          {sessionUrl ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              render={<a href={sessionUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden />
              Open session
            </Button>
          ) : null}
          {canStop ? (
            <Button
              size="sm"
              variant="destructive-outline"
              className="flex-1"
              disabled={stopPending}
              title={
                stopControl.shortcutLabel
                  ? `Stop subagent (${stopControl.shortcutLabel})`
                  : "Stop subagent"
              }
              onClick={() => stopControl.stop(agent.id)}
            >
              <CircleStopIcon aria-hidden />
              {stopPending ? "Stopping…" : "Stop subagent"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {/* Files sit below the actions: the list grows while the subagent runs
          and would otherwise push Stop down under the pointer. */}
      {agent.changedFiles ? (
        <div className="border-t border-border pt-2.5">
          <SubagentFilesSection
            changedFiles={agent.changedFiles}
            workspaceRoot={workspaceRoot}
            onOpenTurnDiff={onOpenTurnDiff}
          />
        </div>
      ) : null}
    </div>
  );
}

function LineageSection({
  model,
  threadKey,
  providerKind,
  threadModelLabel,
  environmentId,
  threadId,
  workspaceRoot,
  onOpenTurnDiff,
  stopControl,
}: {
  model: AgentPanelModel;
  threadKey: string | null;
  providerKind: ProviderDriverKind | null;
  threadModelLabel: string | null;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  workspaceRoot: string | null;
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
  stopControl: InspectorSubagentStop | null;
}) {
  const [showFolded, setShowFolded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const storedSelection = useSubagentSelectionStore((state) =>
    threadKey ? (state.selectedByThreadKey[threadKey] ?? null) : null,
  );
  const revealCount = useSubagentSelectionStore((state) =>
    threadKey ? (state.revealByThreadKey[threadKey] ?? 0) : 0,
  );
  const select = useSubagentSelectionStore((state) => state.select);
  const showInThread = useSubagentSelectionStore((state) => state.showInThread);
  const lineage = useMemo(() => deriveLineage(model), [model]);
  const allAgents = useMemo(
    () => lineage.flatMap((node) => [node.agent, ...nodeMembers(node)]),
    [lineage],
  );
  const selected =
    allAgents.find((agent) => agent.id === storedSelection) ??
    allAgents.find((agent) => isActiveSubagentStatus(agent.status)) ??
    allAgents.at(-1) ??
    null;
  const onSelect = useCallback(
    (agentId: string) => {
      if (threadKey) select(threadKey, agentId);
    },
    [select, threadKey],
  );
  const onShowInThread = useCallback(
    (agentId: string) => {
      if (!threadKey) return;
      select(threadKey, agentId);
      showInThread(threadKey, agentId);
    },
    [select, showInThread, threadKey],
  );

  // Pin the default pick once shown, so the card does not jump to another
  // agent when this one finishes and its result is what the user came for.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (threadKey && selectedId && storedSelection !== selectedId) {
      if (storedSelection === null) select(threadKey, selectedId);
    }
  }, [select, selectedId, storedSelection, threadKey]);

  // A pick from the thread scrolls the row and its card into view.
  useEffect(() => {
    if (revealCount === 0 || !selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-agent-id="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
    cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealCount, selectedId]);

  // Finished top-level rows fold only as the panel opens on live work; rows
  // that finish afterwards stay where they are.
  const [foldedIds] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        model.liveCount > 0
          ? lineage.filter((node) => node.agent.status === "completed").map((node) => node.agent.id)
          : [],
      ),
  );
  const folded = lineage.filter(
    (node) => foldedIds.has(node.agent.id) && node.agent.id !== selectedId,
  );
  const folding = folded.length >= 2;
  const visible =
    folding && !showFolded ? lineage.filter((node) => !folded.includes(node)) : lineage;

  // Coordinators with members are containers; their members carry the work.
  const counted = lineage.flatMap((node) => {
    const members = nodeMembers(node);
    return members.length > 0 ? members : [node.agent];
  });
  const summary = summarizeSubagentStatuses(counted);
  const header = [
    "Lineage",
    summary.text || null,
    model.totalTokens > 0 ? `${formatSubagentTokenCount(model.totalTokens)} tok` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const renderRow = (agent: RuntimeSubagent) => (
    <LineageRow
      key={agent.id}
      agent={agent}
      providerKind={providerKind}
      selected={agent.id === selectedId}
      onSelect={onSelect}
      onShowInThread={threadKey ? onShowInThread : null}
      stopControl={stopControl}
    />
  );

  return (
    <div role="group" aria-label="Lineage" className="flex flex-col">
      <div className="flex h-7 items-center px-2">
        <span className={cn("truncate text-xs font-medium", MUTED)}>{header}</span>
      </div>
      <div className="flex h-7 min-w-0 items-center gap-2.5 px-2">
        <SubagentTile driverKind={providerKind} size="xs" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">This thread</span>
        {threadModelLabel ? (
          <span className={cn("truncate text-xs", MUTED)}>{threadModelLabel}</span>
        ) : null}
      </div>
      {model.hasAgents ? (
        <>
          <div
            ref={listRef}
            role="group"
            aria-label="Subagents"
            onKeyDown={moveLineageFocus}
            className="ms-4 flex flex-col border-s border-sidebar-border ps-2.5"
          >
            {visible.map((node) => (
              <div key={node.agent.id} className="flex flex-col">
                {renderRow(node.agent)}
                {node.phases.length > 0 || node.unphased.length > 0 ? (
                  <div className="ms-4 flex flex-col border-s border-sidebar-border ps-2.5">
                    {node.phases.map((phase) => (
                      <div key={phase.index} className="flex flex-col">
                        <div className={cn("flex h-6 items-center gap-1.5 px-2 text-xs", MUTED)}>
                          <span className="min-w-0 truncate font-medium">{phase.title}</span>
                          <span aria-hidden>·</span>
                          <span className="shrink-0">{PHASE_STATE_WORD[phase.state]}</span>
                        </div>
                        {phase.members.map(renderRow)}
                      </div>
                    ))}
                    {node.unphased.map(renderRow)}
                  </div>
                ) : null}
              </div>
            ))}
            {folding ? (
              <button
                type="button"
                aria-expanded={showFolded}
                onClick={() => setShowFolded((value) => !value)}
                className={cn(
                  "flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-xs outline-none transition-colors hover:bg-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  MUTED,
                )}
              >
                {showFolded ? (
                  <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
                ) : (
                  <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
                )}
                <span className="flex-1">
                  {showFolded ? `Hide ${folded.length} done` : `${folded.length} done`}
                </span>
              </button>
            ) : null}
          </div>
          {selected ? (
            <SubagentDetailCard
              key={selected.id}
              agent={selected}
              providerKind={providerKind}
              environmentId={environmentId}
              threadId={threadId}
              workspaceRoot={workspaceRoot}
              onOpenTurnDiff={onOpenTurnDiff}
              cardRef={cardRef}
              stopControl={stopControl}
            />
          ) : null}
        </>
      ) : (
        <div className="mx-2 mt-1 flex flex-col items-center gap-1.5 rounded-lg bg-accent/40 px-4 py-5 text-center">
          <BotIcon aria-hidden className={cn("size-4.5", MUTED)} />
          <p className="text-xs font-semibold">No subagents yet</p>
          <p className={cn("max-w-56 text-xs", MUTED)}>
            When an agent splits work, each subagent appears here with its status and running time.
          </p>
        </div>
      )}
    </div>
  );
}

interface InspectorOverviewProps {
  model: AgentPanelModel;
  threadKey: string | null;
  providerKind: ProviderDriverKind | null;
  threadModelLabel: string | null;
  workspace: InspectorWorkspace | null;
  subagentStop: InspectorSubagentStop | null;
  /** Latest context window usage; null when the provider reports none. */
  contextWindow: ContextWindowSnapshot | null;
}

function InspectorOverviewView({
  model,
  threadKey,
  providerKind,
  threadModelLabel,
  workspace,
  subagentStop,
  contextWindow,
}: InspectorOverviewProps) {
  const gitCwd = workspace?.gitCwd ?? null;
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-sidebar surface-grain text-sidebar-foreground"
      data-inspector-overview
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-2">
          {workspace?.activeProject ? <WorkspaceSection workspace={workspace} /> : null}
          {workspace && gitCwd ? (
            <SourceControlSection workspace={workspace} gitCwd={gitCwd} />
          ) : null}
          {contextWindow ? <ContextSection snapshot={contextWindow} /> : null}
          <LineageSection
            model={model}
            threadKey={threadKey}
            providerKind={providerKind}
            threadModelLabel={threadModelLabel}
            environmentId={workspace?.environmentId ?? null}
            threadId={workspace?.threadId ?? null}
            workspaceRoot={gitCwd}
            onOpenTurnDiff={workspace?.onOpenTurnDiff ?? null}
            stopControl={subagentStop}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

function shallowEqualWorkspace(
  left: InspectorWorkspace | null,
  right: InspectorWorkspace | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  const keys = Object.keys(left) as Array<keyof InspectorWorkspace>;
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
}

/** The snapshot is re-derived whenever activities change; compare what it shows. */
function sameContextWindow(
  left: ContextWindowSnapshot | null,
  right: ContextWindowSnapshot | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.updatedAt === right.updatedAt &&
    left.usedTokens === right.usedTokens &&
    left.maxTokens === right.maxTokens &&
    left.compactsAutomatically === right.compactsAutomatically &&
    left.autoCompactThreshold === right.autoCompactThreshold
  );
}

/**
 * ChatView rebuilds the workspace object on every render (each streaming
 * delta); comparing it field by field keeps the panel and its controls still.
 */
export const InspectorOverview = memo(
  InspectorOverviewView,
  (previous, next) =>
    previous.model === next.model &&
    previous.threadKey === next.threadKey &&
    previous.providerKind === next.providerKind &&
    previous.threadModelLabel === next.threadModelLabel &&
    previous.subagentStop === next.subagentStop &&
    sameContextWindow(previous.contextWindow, next.contextWindow) &&
    shallowEqualWorkspace(previous.workspace, next.workspace),
);
