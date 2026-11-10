/**
 * Run details: the thread's right panel at rest. It shows whenever the panel is
 * open and no other surface is active. Top to bottom: the agent's plan, how
 * full the context window is, what the thread has cost, the working tree's
 * changes, and the subagents this thread spawned, with the selected one in
 * detail. The provider's nearest plan limit stays pinned to the bottom.
 *
 * Only what providers report is shown: totals, never an invented breakdown.
 *
 * Visualization rules (carried over from the Agents surface it replaces):
 * - Spawn order is stable. Activity and completion update rows in place;
 *   finished rows fold only when the panel opens, never under the pointer.
 * - Status is a glyph plus a word or label, never color alone.
 * - Stop ends one live subagent, not the turn. It shows its pending state on
 *   the control until the provider confirms, and a failure arrives as a toast.
 * - Elapsed timers tick by DOM writes; nothing repaints continuously.
 * - The panel sits on the sidebar ground, so metadata uses the sidebar's
 *   muted role, which every theme tunes for that ground. Cards are raised to
 *   the page background.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectScript,
  ProviderDriverKind,
  ThreadId,
  ThreadUsageTotal,
  TurnId,
  UsageLimitsReport,
} from "@e6tools/contracts";
import { mostConstrainedLimit } from "@e6tools/shared/usageLimits";
import { describeThreadUsage } from "@e6tools/client-runtime/work-log/turn-usage";
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
  formatContextWindowTokens,
} from "@e6tools/client-runtime/work-log/context-window";
import { TASK_LIST_STEP_STATUS_LABELS } from "@e6tools/client-runtime/work-log/task-list";
import { fileBasename, workspaceRelativeFilePath } from "@e6tools/client-runtime/markdown-links";
import {
  BracesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleStopIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
  SquareCheckIcon,
  SquareDotIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { useSubagentSelectionStore } from "~/subagentSelectionStore";
import type { ActivePlanState } from "~/session-logic";
import { DiffStat } from "./DiffStat";
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

/**
 * What Run details needs from the thread's workspace. Workspace actions (open in editor,
 * scripts, commit) live in the thread header, not here.
 */
export interface InspectorWorkspace {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  gitCwd: string | null;
  /**
   * The project's setup script, when the thread runs in a worktree. `changed`
   * means the worktree was set up with an older version of it.
   */
  worktreeSetup: { readonly script: ProjectScript; readonly changed: boolean } | null;
  onRunProjectScript: (script: ProjectScript) => void;
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
/** The raised card the plan and the plan limit sit on. */
const CARD_CLASS_NAME = "rounded-[10px] border border-border bg-background px-3 py-2.5";

/** A Run details section: a 13px heading with mono meta on the right, then its body. */
function DetailsSection({
  title,
  meta,
  metaClassName,
  children,
}: {
  title: string;
  meta?: ReactNode;
  metaClassName?: string | undefined;
  children?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 id={headingId} className="shrink-0 text-[13px] leading-[18px] font-semibold">
          {title}
        </h2>
        {meta !== undefined && meta !== null ? (
          <span
            className={cn(
              "ms-auto min-w-0 truncate font-mono text-[11px] tabular-nums",
              MUTED,
              metaClassName,
            )}
          >
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const PLAN_STEP_ICON = {
  completed: { Icon: SquareCheckIcon, className: "text-success" },
  inProgress: { Icon: SquareDotIcon, className: "text-primary" },
  pending: { Icon: SquareIcon, className: MUTED },
} as const;

/** The agent's latest task list: done steps recede, the current one carries "in progress". */
function PlanSection({ plan }: { plan: ActivePlanState }) {
  const done = plan.steps.filter((step) => step.status === "completed").length;
  // Step text can repeat; numbering repeats keeps keys unique and stable within one plan.
  const seen = new Map<string, number>();
  const keys = plan.steps.map((step) => {
    const count = seen.get(step.step) ?? 0;
    seen.set(step.step, count + 1);
    return `${step.step}#${count}`;
  });
  return (
    <DetailsSection
      title="Plan"
      meta={
        <>
          {done}/{plan.steps.length}
          <span className="sr-only"> steps done</span>
        </>
      }
    >
      <ol className={cn(CARD_CLASS_NAME, "flex flex-col gap-[7px] text-[13px] leading-[18px]")}>
        {plan.steps.map((step, index) => {
          const { Icon, className } = PLAN_STEP_ICON[step.status];
          return (
            <li
              key={keys[index]}
              aria-current={step.status === "inProgress" ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2",
                step.status === "completed" && MUTED,
                step.status === "inProgress" && "font-medium",
              )}
            >
              <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />
              <span className="min-w-0 flex-1 truncate">{step.step}</span>
              {step.status === "inProgress" ? (
                <span className="shrink-0 text-[11px] font-normal text-primary-text">
                  in progress
                </span>
              ) : (
                <span className="sr-only">, {TASK_LIST_STEP_STATUS_LABELS[step.status]}</span>
              )}
            </li>
          );
        })}
      </ol>
    </DetailsSection>
  );
}

/**
 * How full the thread's context window is, from the latest usage the provider
 * reported. Providers that report none never render this section. The bar is
 * static: it moves only when a new snapshot arrives. Providers report one total,
 * so the bar has one fill and no history/files/tools split.
 */
function ContextSection({ snapshot }: { snapshot: ContextWindowSnapshot }) {
  const usage = describeContextWindowUsage(snapshot);
  const used = formatContextWindowTokens(snapshot.usedTokens);
  const max =
    snapshot.maxTokens !== null && snapshot.maxTokens !== undefined && snapshot.maxTokens > 0
      ? formatContextWindowTokens(snapshot.maxTokens)
      : null;
  return (
    <DetailsSection title="Context" meta={max ? `${used} of ${max}` : `${used} used`}>
      {usage.percent !== null ? (
        <div
          role="meter"
          aria-label="Context window usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usage.percent}
          aria-valuetext={usage.label}
          className="h-1.5 overflow-hidden rounded-[2px] bg-surface-well"
        >
          <div
            className={cn("h-full rounded-[2px]", usage.warning ? "bg-warning" : "bg-foreground")}
            style={{ width: `${usage.percent}%` }}
          />
        </div>
      ) : null}
      {usage.warning || usage.compactionNote ? (
        <p className={cn("text-xs", usage.warning ? "text-warning-foreground" : MUTED)}>
          {[usage.warning ? "Nearly full" : null, usage.compactionNote].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </DetailsSection>
  );
}

/**
 * What the thread has cost across all its turns, summed by the server. Providers
 * report a total, so there is no per-category split. Hidden when nothing was reported.
 */
function ThreadCostSection({ usageTotal }: { usageTotal: ThreadUsageTotal | null }) {
  const usage = describeThreadUsage(usageTotal ?? undefined);
  if (!usage) return null;
  const approximate = usage.cost !== null && usageTotal?.costSource === "estimated";
  return (
    <DetailsSection
      title="This thread"
      meta={
        <>
          <span aria-hidden>{usage.cost ?? usage.tokens}</span>
          <span className="sr-only">{usage.accessibilityLabel}</span>
        </>
      }
      metaClassName={usage.cost ? "text-[13px] font-medium text-sidebar-foreground" : undefined}
    >
      {usage.cost ? (
        <p aria-hidden className={cn("text-xs", MUTED)}>
          {usage.tokens}
          {approximate ? " · approximate, some turns were estimated or reported no cost" : null}
        </p>
      ) : null}
    </DetailsSection>
  );
}

/**
 * The working tree at a glance, beside the header's commit actions: line counts,
 * commits to push or pull, and a way into the Diff surface. Hidden until status
 * arrives and outside Git repositories.
 */
function ChangesSection({ workspace, gitCwd }: { workspace: InspectorWorkspace; gitCwd: string }) {
  const { data: status } = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: workspace.environmentId, input: { cwd: gitCwd } }),
  );
  if (!status || !status.isRepo) return null;
  const files = status.workingTree.files.length;
  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount ?? 0;
  const summary = [
    files > 0 ? `${files} ${files === 1 ? "file" : "files"} changed` : "No uncommitted changes",
    ahead > 0 ? `${ahead} to push` : null,
    behind > 0 ? `${behind} to pull` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <DetailsSection
      title="Changes"
      meta={
        files > 0 ? (
          <DiffStat
            additions={status.workingTree.insertions}
            deletions={status.workingTree.deletions}
          />
        ) : null
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-xs", MUTED)}>{summary}</span>
        {workspace.onOpenDiff && files > 0 ? (
          <Button size="xs" variant="outline" className="shrink-0" onClick={workspace.onOpenDiff}>
            Open diff
          </Button>
        ) : null}
      </div>
    </DetailsSection>
  );
}

/**
 * Shown only once the project's setup script changed since this worktree ran it. Running it
 * again records the current script on the thread, which clears the notice; a failed run leaves it.
 */
function WorktreeSetupNotice({ workspace }: { workspace: InspectorWorkspace }) {
  const setup = workspace.worktreeSetup;
  if (!setup?.changed) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[10px] bg-warning-surface px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 text-warning-foreground">
        Setup script changed since this worktree ran it
      </span>
      <Button
        size="xs"
        variant="outline"
        className="shrink-0"
        onClick={() => workspace.onRunProjectScript(setup.script)}
      >
        Run again
      </Button>
    </div>
  );
}

/** The thread provider's limits, as collected for /usage-limits. */
export interface InspectorPlanLimits {
  readonly report: UsageLimitsReport;
  readonly providerLabel: string;
}

/**
 * The provider limit the thread is closest to, pinned under the scrolling sections.
 * Hidden when the provider reports no limits.
 */
function PlanLimitCard({ planLimits }: { planLimits: InspectorPlanLimits }) {
  const nowMinute = useNowMinute();
  const headingId = useId();
  const limit = useMemo(
    () =>
      mostConstrainedLimit(
        planLimits.report,
        planLimits.providerLabel,
        Date.parse(`${nowMinute}:00.000Z`),
      ),
    [nowMinute, planLimits],
  );
  if (!limit) return null;
  return (
    <section aria-labelledby={headingId} className={cn(CARD_CLASS_NAME, "flex flex-col gap-1.5")}>
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-xs leading-4 font-semibold">
          {limit.title}
        </h2>
        <span className="shrink-0 font-mono text-[11px] tabular-nums">{limit.remainingLabel}</span>
      </div>
      <div
        role="meter"
        aria-label={`${limit.title} remaining`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={limit.remainingPercent}
        aria-valuetext={limit.accessibilityLabel}
        className="h-1 overflow-hidden rounded-[2px] bg-surface-well"
      >
        <div
          className={cn("h-full rounded-[2px]", limit.warning ? "bg-warning" : "bg-foreground")}
          style={{ width: `${limit.remainingPercent}%` }}
        />
      </div>
      {limit.detail ? (
        <span
          className={cn(
            "min-w-0 truncate font-mono text-[11px] tabular-nums",
            limit.warning ? "text-warning-foreground" : MUTED,
          )}
        >
          {limit.detail}
        </span>
      ) : null}
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
 * and Stop while it runs. Memoised: SubagentsSection passes stable callbacks,
 * so a row repaints only when its agent, selection or stop control changes.
 */
const LineageRow = memo(function LineageRow({
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
});

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
          <DiffStat additions={additions} deletions={deletions} />
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
                <DiffStat
                  additions={file.additions}
                  deletions={file.deletions}
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
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-background px-3 py-3 text-foreground"
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

/** Every subagent this thread spawned, in spawn order, with the selected one in detail. */
function SubagentsSection({
  model,
  threadKey,
  providerKind,
  environmentId,
  threadId,
  workspaceRoot,
  onOpenTurnDiff,
  stopControl,
}: {
  model: AgentPanelModel;
  threadKey: string | null;
  providerKind: ProviderDriverKind | null;
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
  const meta = [
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
    <DetailsSection title="Subagents" meta={meta || null}>
      <div
        ref={listRef}
        role="group"
        aria-label="Subagents"
        onKeyDown={moveLineageFocus}
        className="-mx-2 flex flex-col"
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
    </DetailsSection>
  );
}

interface InspectorOverviewProps {
  model: AgentPanelModel;
  threadKey: string | null;
  providerKind: ProviderDriverKind | null;
  workspace: InspectorWorkspace | null;
  subagentStop: InspectorSubagentStop | null;
  /** The agent's latest task list; null when it has not published one. */
  plan: ActivePlanState | null;
  /** Latest context window usage; null when the provider reports none. */
  contextWindow: ContextWindowSnapshot | null;
  /** Usage summed over every turn, from the thread shell; null when none was reported. */
  usageTotal: ThreadUsageTotal | null;
  /** The thread provider's limits; null when it reports none. */
  planLimits: InspectorPlanLimits | null;
}

function InspectorOverviewView({
  model,
  threadKey,
  providerKind,
  workspace,
  subagentStop,
  plan,
  contextWindow,
  usageTotal,
  planLimits,
}: InspectorOverviewProps) {
  const gitCwd = workspace?.gitCwd ?? null;
  const hasUsage = describeThreadUsage(usageTotal ?? undefined) !== null;
  const empty =
    (plan === null || plan.steps.length === 0) &&
    contextWindow === null &&
    !hasUsage &&
    !model.hasAgents;
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-sidebar surface-grain text-[13px] leading-[18px] text-sidebar-foreground"
      data-inspector-overview
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {plan && plan.steps.length > 0 ? <PlanSection plan={plan} /> : null}
          {contextWindow ? <ContextSection snapshot={contextWindow} /> : null}
          <ThreadCostSection usageTotal={usageTotal} />
          {workspace ? <WorktreeSetupNotice workspace={workspace} /> : null}
          {workspace && gitCwd ? <ChangesSection workspace={workspace} gitCwd={gitCwd} /> : null}
          {model.hasAgents ? (
            <SubagentsSection
              model={model}
              threadKey={threadKey}
              providerKind={providerKind}
              environmentId={workspace?.environmentId ?? null}
              threadId={workspace?.threadId ?? null}
              workspaceRoot={gitCwd}
              onOpenTurnDiff={workspace?.onOpenTurnDiff ?? null}
              stopControl={subagentStop}
            />
          ) : null}
          {empty ? (
            <p className={cn("text-xs", MUTED)}>
              The plan, context, cost and subagents appear here once the agent reports them.
            </p>
          ) : null}
        </div>
      </ScrollArea>
      {planLimits ? (
        <div className="shrink-0 px-4 pb-4">
          <PlanLimitCard planLimits={planLimits} />
        </div>
      ) : null}
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

/** The plan is re-derived whenever activities change; compare the steps it shows. */
function samePlan(left: ActivePlanState | null, right: ActivePlanState | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.steps.length === right.steps.length &&
    left.steps.every(
      (step, index) =>
        step.step === right.steps[index]?.step && step.status === right.steps[index]?.status,
    )
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

/** Every shell refetch decodes a fresh total; compare what it shows. */
function sameUsageTotal(left: ThreadUsageTotal | null, right: ThreadUsageTotal | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.totalTokens === right.totalTokens &&
    left.costUsd === right.costUsd &&
    left.costSource === right.costSource
  );
}

/**
 * Streaming deltas re-render ChatView; the derived props are compared by what
 * they show, and ChatView memoises the workspace on stable inputs, so the panel
 * and its controls stay still between deltas.
 */
export const InspectorOverview = memo(
  InspectorOverviewView,
  (previous, next) =>
    previous.model === next.model &&
    previous.threadKey === next.threadKey &&
    previous.providerKind === next.providerKind &&
    previous.subagentStop === next.subagentStop &&
    samePlan(previous.plan, next.plan) &&
    sameContextWindow(previous.contextWindow, next.contextWindow) &&
    sameUsageTotal(previous.usageTotal, next.usageTotal) &&
    previous.planLimits === next.planLimits &&
    shallowEqualWorkspace(previous.workspace, next.workspace),
);
