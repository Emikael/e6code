/**
 * Inspector Overview: the right panel's first surface. Workspace actions,
 * source control at a glance, and the lineage of every subagent this thread
 * spawned, with the selected one shown in detail.
 *
 * Visualization rules (carried over from the Agents surface it replaces):
 * - Spawn order is stable. Activity and completion update rows in place.
 * - Status is a glyph plus a word or title, never color alone.
 * - Elapsed timers tick by DOM writes; nothing repaints continuously.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EditorId,
  EnvironmentId,
  ProjectScript,
  ProviderDriverKind,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@e6tools/contracts";
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentProject } from "@e6tools/client-runtime/state/shell";
import {
  type AgentPanelModel,
  type AgentPanelWorkflowGroup,
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  type RuntimeSubagent,
  SUBAGENT_STATUS_LABEL,
  subagentActivityText,
  subagentStatusTone,
} from "@e6tools/client-runtime/state/subagentRuntime";
import {
  BotIcon,
  BracesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  MonitorIcon,
  SquareArrowOutUpRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";

import type { DraftId } from "~/composerDraftStore";
import { useE6ProjectFileScripts } from "~/hooks/useE6ProjectFileScripts";
import { cn } from "~/lib/utils";
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
import { OpenInPicker } from "./chat/OpenInPicker";
import { shouldShowOpenInPicker } from "./chat/ChatHeader";
import {
  SUBAGENT_TONE_TEXT_CLASS,
  SubagentElapsed,
  SubagentStatusGlyph,
  SubagentTile,
} from "./subagents/SubagentParts";
import { Button } from "./ui/button";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { ScrollArea } from "./ui/scroll-area";

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
}

const ROW_CLASS_NAME =
  "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent/60";
const ROW_ICON_CLASS_NAME = "size-4 shrink-0 text-muted-foreground";

function SectionDivider() {
  return <div aria-hidden className="mx-2 my-2 h-px bg-border" />;
}

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
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      {/* Kept mounted so dialogs the control opens outlive the menu. */}
      <MenuPopup keepMounted align="end" className="min-w-56 max-w-[calc(100vw-2rem)]">
        {children(close)}
      </MenuPopup>
    </Menu>
  );
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
  const scriptLabel =
    scripts?.find((script) => script.id === workspace.preferredScriptId)?.name ??
    scripts?.find((script) => script.runOnWorktreeCreate)?.name ??
    "Scripts";

  if (!project) return null;
  return (
    <section aria-label="Workspace" className="flex flex-col gap-px">
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
    </section>
  );
}

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
  const changes = (
    <>
      <span className="font-mono text-xs tabular-nums text-success-foreground">
        +{status?.workingTree.insertions ?? 0}
      </span>
      <span className="font-mono text-xs tabular-nums text-destructive-foreground">
        −{status?.workingTree.deletions ?? 0}
      </span>
    </>
  );
  return (
    <section aria-label="Source control" className="flex flex-col gap-px">
      <div className="flex h-8 min-w-0 items-center gap-2.5 px-2">
        <GitBranchIcon aria-hidden className={ROW_ICON_CLASS_NAME} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {status?.refName ?? "Detached"}
        </span>
        {ahead > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            ↑{ahead}
            <span className="sr-only"> ahead</span>
          </span>
        ) : null}
        {behind > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            ↓{behind}
            <span className="sr-only"> behind</span>
          </span>
        ) : null}
      </div>
      <InspectorMenuRow
        icon={<GitCommitHorizontalIcon aria-hidden className={ROW_ICON_CLASS_NAME} />}
        label="Commit"
        meta={
          <span className="text-xs text-muted-foreground">
            {files === 0 ? "Nothing to commit" : `${files} ${files === 1 ? "file" : "files"}`}
          </span>
        }
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
    </section>
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
        <span className="truncate font-mono text-[.7rem] text-muted-foreground">
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
          <pre className="whitespace-pre-wrap break-words font-mono text-[.7rem] leading-relaxed text-foreground">
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

interface LineageNode {
  readonly agent: RuntimeSubagent;
  readonly children: ReadonlyArray<RuntimeSubagent>;
}

function workflowChildren(group: AgentPanelWorkflowGroup): ReadonlyArray<RuntimeSubagent> {
  return [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
}

/** Top-level lineage in spawn order: workflows carry their members as children. */
function deriveLineage(model: AgentPanelModel): ReadonlyArray<LineageNode> {
  const nodes: LineageNode[] = [
    ...model.workflows.map((group) => ({
      agent: group.workflow,
      children: workflowChildren(group),
    })),
    ...model.directAgents.map((agent) => ({ agent, children: [] })),
  ];
  return nodes.sort(
    (a, b) =>
      a.agent.firstSeenAt.localeCompare(b.agent.firstSeenAt) ||
      a.agent.id.localeCompare(b.agent.id),
  );
}

function LineageRow({
  agent,
  providerKind,
  selected,
  onSelect,
}: {
  agent: RuntimeSubagent;
  providerKind: ProviderDriverKind | null;
  selected: boolean;
  onSelect: (agentId: string) => void;
}) {
  const tone = subagentStatusTone(agent.status);
  return (
    <button
      type="button"
      data-lineage-row
      aria-pressed={selected}
      aria-label={`${agent.title}, ${SUBAGENT_STATUS_LABEL[tone]}`}
      onClick={() => onSelect(agent.id)}
      className={cn(
        "flex h-7.5 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <SubagentTile driverKind={providerKind} size="sm" />
      <span className="min-w-0 flex-1 truncate">{agent.title}</span>
      <SubagentStatusGlyph tone={tone} />
      <SubagentElapsed
        agent={agent}
        className="w-11 shrink-0 text-right text-xs text-muted-foreground"
      />
    </button>
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

function SubagentDetailCard({
  agent,
  providerKind,
  environmentId,
  threadId,
}: {
  agent: RuntimeSubagent;
  providerKind: ProviderDriverKind | null;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const tone = subagentStatusTone(agent.status);
  const live = isActiveSubagentStatus(agent.status);
  const modelLabel = formatSubagentModelLabel(agent.model, agent.effort);
  const role =
    agent.role && agent.role.trim().toLowerCase() !== agent.title.trim().toLowerCase()
      ? agent.role
      : null;
  const activity = live
    ? (agent.progress ?? subagentActivityText(agent))
    : (agent.error ?? agent.result ?? subagentActivityText(agent));
  const scriptPath = agent.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  const sessionUrl = agent.runHandles?.sessionUrl;
  const recent = agent.recentActivity.slice(-4).toReversed();

  return (
    <section
      aria-label={`${agent.title} details`}
      className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-xs"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <SubagentTile driverKind={providerKind} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold">{agent.title}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {[role, modelLabel].filter(Boolean).join(" · ") || "Subagent"}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full bg-accent px-2 text-[11px] font-semibold",
            SUBAGENT_TONE_TEXT_CLASS[tone],
          )}
        >
          <SubagentStatusGlyph tone={tone} className="size-3" />
          {SUBAGENT_STATUS_LABEL[tone]}
        </span>
      </div>
      {activity ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {live ? "Now" : agent.status === "failed" ? "Error" : "Result"}
          </span>
          <p
            className={cn(
              "line-clamp-6 whitespace-pre-wrap break-words text-xs leading-relaxed",
              agent.status === "failed" && "text-destructive-foreground",
            )}
          >
            {activity}
          </p>
        </div>
      ) : null}
      {recent.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-muted-foreground">Recent</span>
          <ul className="flex flex-col gap-0.5">
            {recent.map((entry) => (
              <li
                key={`${entry.at}:${entry.summary}`}
                className="truncate font-mono text-[11px] text-muted-foreground"
              >
                {entry.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="grid grid-cols-3 gap-2 border-t border-border pt-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-muted-foreground">Elapsed</dt>
          <dd className="text-xs">
            <SubagentElapsed agent={agent} />
            {agent.startedAt ? null : <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-muted-foreground">Tokens</dt>
          <dd className="font-mono text-xs tabular-nums">
            {agent.usage ? formatSubagentTokenCount(agent.usage.totalTokens) : "—"}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-muted-foreground">Tool calls</dt>
          <dd className="font-mono text-xs tabular-nums">
            {agent.usage?.toolUses ?? "—"}
            {agent.activationCount > 1 ? (
              <span className="text-muted-foreground"> · run {agent.activationCount}</span>
            ) : null}
          </dd>
        </div>
      </dl>
      {canShowScript || sessionUrl ? (
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
    </section>
  );
}

function LineageSection({
  model,
  threadKey,
  providerKind,
  threadModelLabel,
  environmentId,
  threadId,
}: {
  model: AgentPanelModel;
  threadKey: string | null;
  providerKind: ProviderDriverKind | null;
  threadModelLabel: string | null;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
}) {
  const [showSettled, setShowSettled] = useState(false);
  const storedSelection = useSubagentSelectionStore((state) =>
    threadKey ? (state.selectedByThreadKey[threadKey] ?? null) : null,
  );
  const select = useSubagentSelectionStore((state) => state.select);
  const lineage = useMemo(() => deriveLineage(model), [model]);
  const allAgents = useMemo(
    () => lineage.flatMap((node) => [node.agent, ...node.children]),
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

  // While work is live, finished top-level rows fold so the running ones stay
  // in view. The fold always says how many it holds and opens in place.
  const anyLive = model.liveCount > 0;
  const folded = anyLive
    ? lineage.filter((node) => node.agent.status === "completed" && node.agent.id !== selected?.id)
    : [];
  const foldable = folded.length >= 2 && !showSettled;
  const visible = foldable ? lineage.filter((node) => !folded.includes(node)) : lineage;

  const running = model.runningCount + model.waitingCount;
  const headerParts = [
    running > 0 ? `${running} running` : null,
    model.settledCount + model.idleCount > 0
      ? running > 0
        ? `${model.settledCount + model.idleCount} settled`
        : "all settled"
      : null,
  ].filter(Boolean);

  return (
    <section aria-label="Lineage" className="flex flex-col">
      <div className="flex h-7 items-center px-2">
        <span className="text-xs font-medium text-muted-foreground">
          Lineage{headerParts.length > 0 ? ` · ${headerParts.join(" · ")}` : ""}
        </span>
      </div>
      <div className="flex h-7.5 min-w-0 items-center gap-2.5 px-2">
        <SubagentTile
          driverKind={providerKind}
          size="sm"
          className="border-transparent bg-foreground text-background"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">This thread</span>
        {threadModelLabel ? (
          <span className="truncate text-xs text-muted-foreground">{threadModelLabel}</span>
        ) : null}
      </div>
      {model.hasAgents ? (
        <>
          <div
            role="group"
            aria-label="Subagents"
            onKeyDown={moveLineageFocus}
            className="ms-4 flex flex-col gap-px border-s border-border ps-2"
          >
            {visible.map((node) => (
              <div key={node.agent.id} className="flex flex-col gap-px">
                <LineageRow
                  agent={node.agent}
                  providerKind={providerKind}
                  selected={node.agent.id === selected?.id}
                  onSelect={onSelect}
                />
                {node.children.length > 0 ? (
                  <div className="ms-4 flex flex-col gap-px border-s border-border ps-2">
                    {node.children.map((child) => (
                      <LineageRow
                        key={child.id}
                        agent={child}
                        providerKind={providerKind}
                        selected={child.id === selected?.id}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {folded.length >= 2 ? (
              <button
                type="button"
                aria-expanded={showSettled}
                onClick={() => setShowSettled((value) => !value)}
                className="flex h-7.5 w-full items-center gap-2.5 rounded-md px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showSettled ? (
                  <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
                ) : (
                  <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
                )}
                <span className="flex-1">{folded.length} done</span>
                <span className="text-success-foreground">{showSettled ? "Hide" : "Show"}</span>
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
            />
          ) : null}
        </>
      ) : (
        <div className="mx-2 mt-1 flex flex-col items-center gap-1.5 rounded-lg bg-accent/40 px-4 py-5 text-center">
          <BotIcon aria-hidden className="size-4.5 text-muted-foreground" />
          <p className="text-xs font-semibold">No subagents yet</p>
          <p className="max-w-56 text-xs text-muted-foreground">
            When an agent splits work, each subagent appears here with its status and running time.
          </p>
        </div>
      )}
    </section>
  );
}

export function InspectorOverview({
  model,
  threadKey,
  providerKind,
  threadModelLabel,
  workspace,
}: {
  model: AgentPanelModel;
  threadKey: string | null;
  providerKind: ProviderDriverKind | null;
  threadModelLabel: string | null;
  workspace: InspectorWorkspace | null;
}) {
  const gitCwd = workspace?.gitCwd ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar" data-inspector-overview>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-2">
          {workspace?.activeProject ? (
            <>
              <WorkspaceSection workspace={workspace} />
              <SectionDivider />
            </>
          ) : null}
          {workspace && gitCwd ? (
            <>
              <SourceControlSection workspace={workspace} gitCwd={gitCwd} />
              <SectionDivider />
            </>
          ) : null}
          <LineageSection
            model={model}
            threadKey={threadKey}
            providerKind={providerKind}
            threadModelLabel={threadModelLabel}
            environmentId={workspace?.environmentId ?? null}
            threadId={workspace?.threadId ?? null}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
