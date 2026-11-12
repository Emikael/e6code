/**
 * The work log: thread activities folded into the rows a timeline shows, one
 * per tool step, agent or notice. Shared by the web timeline and anything else
 * that needs the same facts, such as the recap.
 */
import {
  requestKindFromRequestType,
  type PendingApproval,
} from "@e6tools/client-runtime/pending-requests";
import {
  TURN_USAGE_ACTIVITY_KIND,
  UserInputAttachmentAnswerPayload,
  isToolLifecycleItemType,
  type OrchestrationThreadActivity,
  type ToolLifecycleItemType,
  type TurnId,
} from "@e6tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { foldUserInputActivities } from "@e6tools/client-runtime/work-log/user-input";
import { isBackgroundTaskActivity } from "@e6tools/client-runtime/state/subagentRuntime";
import {
  commandDetailRepeatsCommand,
  extractCommandOutputText,
  extractWorkLogToolLifecycleStatus,
  isWorktreeSetupActivity,
  normalizeCompactToolLabel,
  type WorkLogToolLifecycleStatus,
} from "@e6tools/client-runtime/work-log/presentation";
import { extractToolActivityPresentation } from "@e6tools/client-runtime/work-log/tool-presentation";
import {
  mainAgentDiffStat,
  type WorkLogDiffStat,
} from "@e6tools/client-runtime/work-log/diff-stat";
import { mergeWorkStepStartedAt } from "@e6tools/client-runtime/work-log/step-meta";
import {
  isTaskListToolActivity,
  taskListLabel,
  taskListStepsFromPayload,
  taskListText,
} from "@e6tools/client-runtime/work-log/task-list";

export interface WorkLogEntry {
  questionAnswer?: UserInputAttachmentAnswerPayload;
  id: string;
  createdAt: string;
  turnId?: TurnId | null;
  /** Stable provider identity across in-progress and completed lifecycle updates. */
  toolCallId?: string;
  label: string;
  detail?: string;
  viewedImagePath?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  /**
   * When the step began, kept from the first lifecycle row once later rows
   * (which move `createdAt` forward) merge into it. Absent on single-row steps.
   */
  startedAt?: string;
  /** Lines a main-agent file change added and removed, when the provider counted its files. */
  diffStat?: WorkLogDiffStat;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  toolSurface?: import("@e6tools/contracts").ToolActivitySurface;
  toolIcon?: import("@e6tools/contracts").ToolActivityIcon;
  toolSource?: import("@e6tools/contracts").ToolActivitySource;
  toolData?: unknown;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  /** From runtime item / task payload `status` when present (e.g. tool.updated). */
  toolLifecycleStatus?: WorkLogToolLifecycleStatus;
  /** Originating orchestration activity kind (e.g. `user-input.requested`) for row chrome. */
  sourceActivityKind?: OrchestrationThreadActivity["kind"];
  /** Grouping key for subagent lifecycle rows (one row per agent). */
  taskId?: string;
  /** Agent role (subagent_type) for labeled timeline rows. */
  agentRole?: string;
  /**
   * Present on agent-spawn rows: one per workflow run or per-turn batch of
   * direct spawns. The row ("Kicked off N subagents") derives its live
   * status and member list from the agent panel model at render time.
   */
  agentSpawn?: {
    /** Workflow coordinator taskId, or null for a direct-spawn batch. */
    workflowId: string | null;
    agentTaskIds: ReadonlyArray<string>;
  };
}

const workLogCollapseKey = Symbol();

interface DerivedWorkLogEntry extends WorkLogEntry {
  sourceActivityKind: OrchestrationThreadActivity["kind"];
  [workLogCollapseKey]?: string;
  toolCallId?: string;
  isWorkflowCoordinator?: boolean;
  /** Shell/monitor/plan tasks: ordinary work-log rows, never spawn CTAs. */
  isBackgroundTask?: boolean;
}

const derivedWorkLogEntryByActivity = new WeakMap<
  OrchestrationThreadActivity,
  DerivedWorkLogEntry
>();

/**
 * Quiet-timeline guarantee: the work log carries the parent's narrative plus
 * at most one row per agent. Everything an agent does internally lives in the
 * Agents surface:
 * - timelineBypass rows (Codex children, workflow members) never render here;
 * - tool rows attributed to an owning agent (payload.agentId) are re-homed;
 * - task.progress ticks collapse into one row per taskId;
 * - task.updated is fold input only (status patches are not narrative).
 * Unattributed rows stay unless a linked agent row replaces their launch;
 * failed launches stay so the only terminal signal cannot disappear.
 */
/** Agent (non-background) task.started rows seed spawn CTA batches. */
function isAgentTaskStartedActivity(activity: OrchestrationThreadActivity): boolean {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  if (!payload || typeof payload.taskId !== "string") {
    return false;
  }
  return !isBackgroundTaskActivity(payload);
}

function isAgentInternalActivity(activity: OrchestrationThreadActivity): boolean {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return false;
  }
  const isTaskRow =
    activity.kind === "task.started" ||
    activity.kind === "task.progress" ||
    activity.kind === "task.updated" ||
    activity.kind === "task.completed";
  // Task rows classify by the server stamp: a subagent's own background
  // shell (agentId + "background") is agent-internal, but a nested AGENT
  // (agentId + "agent") stays visible so its rows can anchor a spawn row
  // (review finding: hiding on agentId alone removed nested agents and
  // their anchors). Bypassed agent lifecycle rows also pass — collapse
  // folds every such row into its batch's single CTA row, which is how
  // Codex children (whose rows are ALL bypassed) get an anchor at the
  // spawn point.
  if (isTaskRow) {
    const ownedByAgent = typeof payload.agentId === "string" && payload.agentId.trim().length > 0;
    if (ownedByAgent || payload.timelineBypass === true) {
      const isAgentTaskRow =
        activity.kind !== "task.updated" &&
        typeof payload.taskId === "string" &&
        !isBackgroundTaskActivity(payload);
      return !isAgentTaskRow;
    }
    return false;
  }
  if (payload.timelineBypass === true) {
    return true;
  }
  // Non-task rows (attributed tool activity) owned by an agent are internal.
  return typeof payload.agentId === "string" && payload.agentId.trim().length > 0;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkLogEntry[] {
  const ordered = [...activities].sort(compareActivitiesByOrder);
  // A launch tool and its task lifecycle describe the same run. Only hide
  // launch rows once their tool-use id has an agent row to replace them.
  const agentLaunchToolIds = new Set<string>();
  for (const activity of ordered) {
    if (
      (activity.kind === "task.started" ||
        activity.kind === "task.progress" ||
        activity.kind === "task.completed") &&
      isAgentTaskStartedActivity(activity)
    ) {
      const toolUseId = asTrimmedString(asRecord(activity.payload)?.toolUseId);
      if (toolUseId) agentLaunchToolIds.add(toolUseId);
    }
  }
  // Claude's todo tools also emit a plan update, whose Tasks row already shows the change.
  const planUpdateTurnIds = new Set(
    ordered.flatMap((activity) =>
      activity.kind === "turn.plan.updated" && activity.turnId ? [activity.turnId] : [],
    ),
  );
  const entries: DerivedWorkLogEntry[] = [];
  // tool.started rows never render, but their timestamp is when the step began.
  const toolStartedAtById = new Map<string, string>();
  for (const activity of foldUserInputActivities(ordered)) {
    if (
      isWorktreeSetupActivity(activity.kind) &&
      (activity.tone !== "error" || activity.kind === "worktree-setup")
    ) {
      continue;
    }
    if (activity.kind === "tool.started") {
      const toolCallId = extractToolCallId(asRecord(activity.payload));
      if (toolCallId && !toolStartedAtById.has(toolCallId)) {
        toolStartedAtById.set(toolCallId, activity.createdAt);
      }
      continue;
    }
    // Agent task.started rows are CTA seeds: they carry the true spawn turn,
    // which is the batch key (completions of background subagents arrive
    // under later synthetic turns and must not start new batches). They
    // collapse into the batch's single CTA row, never render standalone.
    if (activity.kind === "task.started" && !isAgentTaskStartedActivity(activity)) continue;
    if (activity.kind === "task.updated") continue;
    if (activity.kind === "tool.progress") continue;
    if (activity.kind === "context-window.updated") continue;
    // Folded into the turn's "Worked for ..." row instead.
    if (activity.kind === TURN_USAGE_ACTIVITY_KIND) continue;
    if (activity.kind === "turn.plan.updated") {
      const todoEntry = todoListWorkLogEntry(activity);
      if (todoEntry) entries.push(todoEntry);
      continue;
    }
    if (activity.summary === "Checkpoint captured") continue;
    if (isNoContentRuntimeWarning(activity)) continue;
    if (isPlanBoundaryToolActivity(activity)) continue;
    if (isAgentInternalActivity(activity)) continue;
    if (isTaskListToolActivity(activity, planUpdateTurnIds)) continue;
    const entry = toDerivedWorkLogEntry(activity);
    if (entry.startedAt === undefined && entry.toolCallId) {
      // The start is immutable, so stamping the cached entry is idempotent.
      const startedAt = toolStartedAtById.get(entry.toolCallId);
      if (startedAt !== undefined && startedAt !== entry.createdAt) entry.startedAt = startedAt;
    }
    // Native agent launches get their visible row from task.started. Defer
    // their active tool row so another launch cannot duplicate the batch.
    if (
      activity.kind === "tool.updated" &&
      entry.itemType === "collab_agent_tool_call" &&
      entry.toolLifecycleStatus === "inProgress" &&
      entry.tone !== "error"
    ) {
      const toolName = asRecord(asRecord(activity.payload)?.data)?.toolName;
      if (toolName === "Agent" || toolName === "Task") continue;
    }
    if (
      (activity.kind === "tool.updated" || activity.kind === "tool.completed") &&
      entry.toolCallId &&
      agentLaunchToolIds.has(entry.toolCallId) &&
      entry.tone !== "error" &&
      entry.toolLifecycleStatus !== "failed"
    ) {
      continue;
    }
    entries.push(entry);
  }
  return collapseDerivedWorkLogEntries(entries);
}

/** Adapters forward unknown wire-only SDK messages (background_tasks_changed,
 *  commands_changed, ...) as runtime warnings. The suffix comes from
 *  describeUnknownSdkMessage in the Claude adapter; a row with no displayable
 *  text carries nothing a user can act on, so it does not render. */
function isNoContentRuntimeWarning(activity: OrchestrationThreadActivity): boolean {
  return (
    activity.kind === "runtime.warning" &&
    activity.summary.endsWith("(no displayable text content)")
  );
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

const decodeQuestionAttachmentAnswer = Schema.decodeUnknownOption(UserInputAttachmentAnswerPayload);

/** Each todo update is a quiet row where the agent wrote it; it opens to every step. */
function todoListWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry | null {
  const cachedEntry = derivedWorkLogEntryByActivity.get(activity);
  if (cachedEntry) return cachedEntry;
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const steps = taskListStepsFromPayload(payload);
  if (!steps || steps.length === 0) return null;
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    label: taskListLabel(steps),
    detail: taskListText(steps),
    tone: "info",
    sourceActivityKind: activity.kind,
  };
  derivedWorkLogEntryByActivity.set(activity, entry);
  return entry;
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const cachedEntry = derivedWorkLogEntryByActivity.get(activity);
  if (cachedEntry) {
    return cachedEntry;
  }
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const commandPreview = extractToolCommand(payload);
  const changedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  const toolPresentation = extractToolActivityPresentation(payload);
  const isTaskActivity =
    activity.kind === "task.started" ||
    activity.kind === "task.progress" ||
    activity.kind === "task.completed";
  const taskSummary =
    isTaskActivity && typeof payload?.summary === "string" && payload.summary.length > 0
      ? payload.summary
      : null;
  const taskDetailAsLabel =
    isTaskActivity &&
    !taskSummary &&
    typeof payload?.detail === "string" &&
    payload.detail.length > 0
      ? payload.detail
      : null;
  const taskLabel = taskSummary || taskDetailAsLabel;
  const detail = isTaskActivity
    ? !taskDetailAsLabel &&
      payload &&
      typeof payload.detail === "string" &&
      payload.detail.length > 0
      ? stripTrailingExitCode(payload.detail).output
      : null
    : extractToolDetail(payload, title ?? activity.summary);
  const toolCallId = isTaskActivity ? null : extractToolCallId(payload);
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    label: taskLabel || activity.summary,
    tone:
      activity.kind === "task.progress"
        ? "thinking"
        : activity.tone === "approval"
          ? "info"
          : activity.tone,
    sourceActivityKind: activity.kind,
  };
  if (activity.kind === "user-input.answer-submitted") {
    const answer = decodeQuestionAttachmentAnswer(payload);
    if (Option.isSome(answer)) entry.questionAnswer = answer.value;
  }
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  const viewedImagePath = asTrimmedString(asRecord(payload?.data)?.imagePath);
  if (detail) {
    entry.detail = detail;
  } else if (activity.kind === "runtime.error" || activity.kind === "runtime.warning") {
    const message = asTrimmedString(payload?.message);
    if (
      message &&
      normalizePreviewForComparison(message) !== normalizePreviewForComparison(activity.summary)
    ) {
      entry.detail = message;
    }
  }
  if (viewedImagePath) {
    entry.viewedImagePath = viewedImagePath;
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  const diffStat = mainAgentDiffStat(payload, changedFiles);
  if (diffStat) {
    entry.diffStat = diffStat;
  }
  if (title) {
    entry.toolTitle = title;
  }
  if (toolPresentation.toolSurface) {
    entry.toolSurface = toolPresentation.toolSurface;
  }
  if (toolPresentation.toolIcon) {
    entry.toolIcon = toolPresentation.toolIcon;
  }
  if (toolPresentation.toolSource) {
    entry.toolSource = toolPresentation.toolSource;
  }
  if (itemType === "mcp_tool_call") {
    const data = asRecord(payload?.data);
    const toolData = typeof data?.toolName === "string" ? (data.item ?? data) : data?.item;
    if (toolData !== undefined) {
      entry.toolData = toolData;
    }
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  if (toolCallId) {
    entry.toolCallId = toolCallId;
  }
  let toolLifecycleStatus = extractWorkLogToolLifecycleStatus(payload);
  if (!toolLifecycleStatus && activity.kind === "tool.completed") {
    toolLifecycleStatus = "completed";
  }
  if (toolLifecycleStatus) {
    entry.toolLifecycleStatus = toolLifecycleStatus;
  }
  if (isTaskActivity && typeof payload?.taskId === "string" && payload.taskId.length > 0) {
    entry.taskId = payload.taskId;
  }
  if (isTaskActivity && typeof payload?.role === "string" && payload.role.length > 0) {
    entry.agentRole = payload.role;
  }
  if (
    isTaskActivity &&
    (payload?.taskType === "local_workflow" ||
      (typeof payload?.workflowName === "string" && payload.workflowName.length > 0))
  ) {
    entry.isWorkflowCoordinator = true;
  }
  if (isTaskActivity && payload && isBackgroundTaskActivity(payload)) {
    entry.isBackgroundTask = true;
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry[workLogCollapseKey] = collapseKey;
  }
  derivedWorkLogEntryByActivity.set(activity, entry);
  return entry;
}

/**
 * Spawn-group key for a subagent lifecycle row. Workflow members and their
 * coordinator share the coordinator's group; direct spawns batch per turn.
 * One CTA row per group (A1 design): "Kicked off N subagents".
 */
function agentSpawnGroupKey(entry: DerivedWorkLogEntry): string {
  const taskId = entry.taskId ?? "";
  const workflowSlot = taskId.indexOf(":wf:");
  if (workflowSlot !== -1) {
    return `wf:${taskId.slice(0, workflowSlot)}`;
  }
  if (entry.agentSpawn?.workflowId) {
    return `wf:${entry.agentSpawn.workflowId}`;
  }
  if (entry.isWorkflowCoordinator) {
    return `wf:${taskId}`;
  }
  // No turn id means no batch signal at all: fall back to one group per
  // task. Unrelated turn-less spawns (separate fleets whose rows lost their
  // turn) must not collapse into one immortal "direct:no-turn" CTA
  // accumulating every agent the thread ever ran (review finding). Adapters
  // stamp spawn turns (Codex spawnTurnId; Claude rows ride real turns), so
  // this path is defensive.
  return entry.turnId ? `direct:${entry.turnId}` : `direct:task:${taskId}`;
}

function toolLifecycleCollapseMapKey(entry: DerivedWorkLogEntry): string | undefined {
  if (
    entry.sourceActivityKind !== "tool.updated" &&
    entry.sourceActivityKind !== "tool.completed"
  ) {
    return undefined;
  }
  return entry.toolCallId ? `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}` : undefined;
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  // Subagent rows collapse by spawn group, not adjacency: a workflow run (or
  // a turn's batch of direct spawns) is ONE narrative event in the chat — a
  // spawn row in the timeline — no matter how many agents it
  // contains or how their progress rows interleave (quiet-timeline
  // guarantee).
  const spawnRowIndex = new Map<string, number>();
  // Batch membership is decided once, at the FIRST row seen for a taskId.
  // Claude background subagents settle between turns, so their completion
  // rows carry fresh synthetic turn ids (or none) — keying each row by its
  // own turn splintered one batch into a stream of "Kicked off N subagents"
  // rows (live-test finding, thread 7ac7ef05).
  const groupKeyByTaskId = new Map<string, string>();
  const toolLifecycleRowIndex = new Map<string, number>();
  for (const entry of entries) {
    const isTaskRow =
      entry.taskId !== undefined &&
      !entry.isBackgroundTask &&
      (entry.sourceActivityKind === "task.started" ||
        entry.sourceActivityKind === "task.progress" ||
        entry.sourceActivityKind === "task.completed");
    if (isTaskRow && entry.taskId !== undefined) {
      const rememberedKey = groupKeyByTaskId.get(entry.taskId);
      const groupKey = rememberedKey ?? agentSpawnGroupKey(entry);
      if (rememberedKey === undefined) {
        groupKeyByTaskId.set(entry.taskId, groupKey);
      }
      const workflowId = groupKey.startsWith("wf:") ? groupKey.slice(3) : null;
      const existingIndex = spawnRowIndex.get(groupKey);
      if (existingIndex !== undefined) {
        const existing = collapsed[existingIndex]!;
        const agentTaskIds = existing.agentSpawn?.agentTaskIds.includes(entry.taskId)
          ? existing.agentSpawn.agentTaskIds
          : [...(existing.agentSpawn?.agentTaskIds ?? []), entry.taskId];
        collapsed[existingIndex] = {
          ...mergeDerivedWorkLogEntries(existing, entry),
          // The CTA row keeps the group's ANCHOR identity, not the last
          // agent's: id/createdAt/turnId stay pinned to the spawn point so
          // the row renders where the run launched instead of drifting to
          // the newest progress tick (mid-run it drifted below the whole
          // conversation, reading as "no visualization"), and the stable id
          // keeps React state/virtualization sane.
          id: existing.id,
          createdAt: existing.createdAt,
          turnId: existing.turnId ?? null,
          ...(existing.taskId !== undefined ? { taskId: existing.taskId } : {}),
          label: existing.label,
          agentSpawn: { workflowId, agentTaskIds },
        };
        continue;
      }
      spawnRowIndex.set(groupKey, collapsed.length);
      collapsed.push({
        ...entry,
        agentSpawn: { workflowId, agentTaskIds: [entry.taskId] },
      });
      continue;
    }
    const lifecycleKey = toolLifecycleCollapseMapKey(entry);
    if (lifecycleKey !== undefined) {
      const matchingLifecycleIndex = toolLifecycleRowIndex.get(lifecycleKey);
      const matchingEntry =
        matchingLifecycleIndex === undefined ? undefined : collapsed[matchingLifecycleIndex];
      if (
        matchingLifecycleIndex !== undefined &&
        matchingEntry &&
        shouldCollapseToolLifecycleEntries(matchingEntry, entry)
      ) {
        collapsed[matchingLifecycleIndex] = mergeDerivedWorkLogEntries(matchingEntry, entry);
        continue;
      }
      toolLifecycleRowIndex.delete(lifecycleKey);
    }
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      const previousIndex = collapsed.length - 1;
      const previousKey = toolLifecycleCollapseMapKey(previous);
      if (previousKey !== undefined) toolLifecycleRowIndex.delete(previousKey);
      const merged = mergeDerivedWorkLogEntries(previous, entry);
      collapsed[previousIndex] = merged;
      const mergedKey = toolLifecycleCollapseMapKey(merged);
      if (mergedKey !== undefined) toolLifecycleRowIndex.set(mergedKey, previousIndex);
      continue;
    }
    collapsed.push(entry);
    if (lifecycleKey !== undefined) {
      toolLifecycleRowIndex.set(lifecycleKey, collapsed.length - 1);
    }
  }
  return collapsed;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (
    previous.sourceActivityKind !== "tool.updated" &&
    previous.sourceActivityKind !== "tool.completed"
  ) {
    return false;
  }
  if (next.sourceActivityKind !== "tool.updated" && next.sourceActivityKind !== "tool.completed") {
    return false;
  }
  if (previous.turnId !== next.turnId) {
    return false;
  }
  if (previous.sourceActivityKind === "tool.completed") {
    return false;
  }
  if (
    previous[workLogCollapseKey] !== undefined &&
    previous[workLogCollapseKey] === next[workLogCollapseKey]
  ) {
    return true;
  }
  return (
    previous.toolCallId !== undefined &&
    next.toolCallId === undefined &&
    previous.itemType === next.itemType &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label)
  );
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const viewedImagePath = next.viewedImagePath ?? previous.viewedImagePath;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const toolSurface = next.toolSurface ?? previous.toolSurface;
  const toolIcon = next.toolIcon ?? previous.toolIcon;
  const toolSource = next.toolSource ?? previous.toolSource;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next[workLogCollapseKey] ?? previous[workLogCollapseKey];
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const toolLifecycleStatus = next.toolLifecycleStatus ?? previous.toolLifecycleStatus;
  const toolData = next.toolData ?? previous.toolData;
  const diffStat = next.diffStat ?? previous.diffStat;
  const startedAt = mergeWorkStepStartedAt(previous, next);
  return {
    ...previous,
    ...next,
    ...(detail ? { detail } : {}),
    ...(viewedImagePath ? { viewedImagePath } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(toolSurface ? { toolSurface } : {}),
    ...(toolIcon ? { toolIcon } : {}),
    ...(toolSource ? { toolSource } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { [workLogCollapseKey]: collapseKey } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolLifecycleStatus !== undefined ? { toolLifecycleStatus } : {}),
    ...(toolData !== undefined ? { toolData } : {}),
    ...(diffStat ? { diffStat } : {}),
    ...(startedAt ? { startedAt } : {}),
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  // Subagent lifecycle rows collapse by agent identity: one row per agent,
  // progress ticks fold into it, the terminal row wins the label.
  if (
    entry.taskId &&
    (entry.sourceActivityKind === "task.progress" || entry.sourceActivityKind === "task.completed")
  ) {
    return `task${entry.taskId}`;
  }
  if (
    entry.sourceActivityKind !== "tool.updated" &&
    entry.sourceActivityKind !== "tool.completed"
  ) {
    return undefined;
  }
  if (entry.toolCallId) {
    return `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const openingQuote = command[0];
  if ((openingQuote === "'" || openingQuote === '"') && !command.endsWith(openingQuote)) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  if (!/[\s"'`]/.test(value)) return value;
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === '"') escaped += "\\";
    escaped += char;
  }
  return `"${escaped}"`;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts: Array<string> = [];
  for (const entry of value) {
    const part = asTrimmedString(entry);
    if (part !== null) {
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function extractToolCommand(payload: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const itemType = asTrimmedString(payload?.itemType);
  const detail = asTrimmedString(payload?.detail);
  const candidates: unknown[] = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripTrailingExitCode(detail).output : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  return asTrimmedString(payload?.toolCallId) ?? asTrimmedString(data?.toolCallId);
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateInlinePreview(value: string, maxLength = 84): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizePreviewForComparison(value: string | null | undefined): string | null {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  return normalizeCompactToolLabel(normalizeInlinePreview(normalized)).toLowerCase();
}

function summarizeToolTextOutput(value: string): string | null {
  const lines: Array<string> = [];
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = normalizeInlinePreview(rawLine);
    if (line.length > 0) {
      lines.push(line);
    }
  }
  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) {
    return truncateInlinePreview(firstLine);
  }
  if (lines.length > 1) {
    return `${lines.length.toLocaleString()} lines`;
  }
  return null;
}

function summarizeToolRawOutput(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const rawOutput = asRecord(data?.rawOutput);
  if (!rawOutput) {
    return null;
  }

  const totalFiles = asNumber(rawOutput.totalFiles);
  if (totalFiles !== null) {
    const suffix = rawOutput.truncated === true ? "+" : "";
    return `${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) {
    return summarizeToolTextOutput(content);
  }

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) {
    return summarizeToolTextOutput(stdout);
  }

  return null;
}

function extractToolOutput(payload: Record<string, unknown> | null): string | null {
  const output = extractCommandOutputText(payload?.data);
  return output ? stripTrailingExitCode(output).output : null;
}

function isCommandToolDetail(payload: Record<string, unknown> | null, heading: string): boolean {
  const data = asRecord(payload?.data);
  const kind = asTrimmedString(data?.kind)?.toLowerCase();
  const title = asTrimmedString(payload?.title ?? heading)?.toLowerCase();
  return (
    extractWorkLogItemType(payload) === "command_execution" ||
    kind === "execute" ||
    title === "terminal" ||
    title === "ran command"
  );
}

function extractToolDetail(
  payload: Record<string, unknown> | null,
  heading: string,
): string | null {
  const rawDetail = asTrimmedString(payload?.detail);
  const detail = rawDetail ? stripTrailingExitCode(rawDetail).output : null;
  const normalizedHeading = normalizePreviewForComparison(heading);
  const normalizedDetail = normalizePreviewForComparison(detail);
  const commandTool = isCommandToolDetail(payload, heading);
  const commandPreview = commandTool
    ? extractToolCommand(payload)
    : { command: null, rawCommand: null };
  const command = commandPreview.command;

  if (commandTool && command) {
    const output = extractToolOutput(payload);
    if (output) return output;
  }

  const data = asRecord(payload?.data);
  const repeatsCommand =
    detail !== null &&
    commandDetailRepeatsCommand({
      detail,
      command,
      rawCommand: commandPreview.rawCommand,
      toolName: data?.toolName,
      data,
    });

  if (detail && normalizedHeading !== normalizedDetail && (!commandTool || !repeatsCommand)) {
    return detail;
  }

  if (commandTool) {
    return null;
  }

  const rawOutputSummary = summarizeToolRawOutput(payload);
  if (rawOutputSummary) {
    const normalizedRawOutputSummary = normalizePreviewForComparison(rawOutputSummary);
    if (normalizedRawOutputSummary !== normalizedHeading) {
      return rawOutputSummary;
    }
  }

  return null;
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change" ||
    payload?.requestKind === "permission"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

export function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}
