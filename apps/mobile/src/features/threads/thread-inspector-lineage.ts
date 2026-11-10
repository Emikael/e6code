import type { OrchestrationSession, OrchestrationThreadActivity, TurnId } from "@e6tools/contracts";
import {
  type TaskListStep,
  taskListStepsFromPayload,
} from "@e6tools/client-runtime/work-log/task-list";
import {
  type AgentPanelModel,
  type AgentPanelWorkflowGroup,
  formatSubagentTokenCount,
  type RuntimeSubagent,
  summarizeSubagentStatuses,
} from "@e6tools/client-runtime/state/subagentRuntime";

type LineagePhaseState = AgentPanelWorkflowGroup["phases"][number]["state"];

export type InspectorLineageRow =
  | {
      readonly kind: "agent";
      readonly key: string;
      readonly agent: RuntimeSubagent;
      /** 1 for a workflow member, drawn indented under its workflow row. */
      readonly depth: 0 | 1;
    }
  | {
      readonly kind: "phase";
      readonly key: string;
      readonly title: string;
      readonly state: LineagePhaseState;
    };

export interface InspectorLineage {
  readonly rows: ReadonlyArray<InspectorLineageRow>;
  /** Section label: "Subagents · 3 working · 1 done", plus tokens once known. */
  readonly label: string;
}

/**
 * Flattens the panel model into the Inspector's lineage list. Top-level rows
 * keep spawn order; a workflow is followed by its members, phase by phase,
 * then any members whose phase is unknown. The label counts the members of a
 * workflow instead of its coordinator, matching web's Run details.
 */
export function deriveInspectorLineage(model: AgentPanelModel): InspectorLineage {
  const nodes = [
    ...model.workflows.map((group) => ({ agent: group.workflow, group })),
    ...model.directAgents.map((agent) => ({ agent, group: null })),
  ].sort(
    (a, b) =>
      a.agent.firstSeenAt.localeCompare(b.agent.firstSeenAt) ||
      a.agent.id.localeCompare(b.agent.id),
  );

  const rows: InspectorLineageRow[] = [];
  const counted: RuntimeSubagent[] = [];
  for (const { agent, group } of nodes) {
    rows.push({ kind: "agent", key: agent.id, agent, depth: 0 });
    if (group === null) {
      counted.push(agent);
      continue;
    }
    const members: RuntimeSubagent[] = [];
    for (const phase of group.phases) {
      rows.push({
        kind: "phase",
        key: `${agent.id}:phase:${phase.index}`,
        title: phase.title,
        state: phase.state,
      });
      members.push(...phase.members);
      for (const member of phase.members) {
        rows.push({ kind: "agent", key: member.id, agent: member, depth: 1 });
      }
    }
    members.push(...group.unphasedMembers);
    for (const member of group.unphasedMembers) {
      rows.push({ kind: "agent", key: member.id, agent: member, depth: 1 });
    }
    counted.push(...(members.length > 0 ? members : [agent]));
  }

  const summary = summarizeSubagentStatuses(counted);
  const label = [
    "Subagents",
    summary.text || null,
    model.totalTokens > 0 ? `${formatSubagentTokenCount(model.totalTokens)} tok` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { rows, label };
}

/**
 * Same liveness rule as web's session phase: without a running provider
 * session, agents still marked active can never finish and fold as stopped.
 */
export function subagentSessionIsLive(session: Pick<OrchestrationSession, "status"> | null) {
  return (
    session !== null &&
    session.status !== "stopped" &&
    session.status !== "interrupted" &&
    session.status !== "error"
  );
}

/** The header button's label carries the count the badge shows. */
export function inspectorButtonAccessibilityLabel(liveCount: number): string {
  if (liveCount <= 0) return "Open run details";
  return `Open run details, ${liveCount} ${liveCount === 1 ? "subagent" : "subagents"} running`;
}

/** Web's activity order: sequenced activities after unsequenced ones, then time, then id. */
function comparePlanActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * The agent's current plan for Run details: the latest `turn.plan.updated` of
 * the latest turn, else the latest from any turn so a plan persists across
 * follow-ups. A cleared plan shows none. Mirrors web's deriveActivePlanState,
 * without its step durations.
 */
export function deriveRunDetailsPlanSteps(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | null | undefined,
): ReadonlyArray<TaskListStep> | null {
  let latest: OrchestrationThreadActivity | null = null;
  let latestOfTurn: OrchestrationThreadActivity | null = null;
  for (const activity of activities) {
    if (activity.kind !== "turn.plan.updated") continue;
    if (latest === null || comparePlanActivities(activity, latest) > 0) latest = activity;
    if (
      latestTurnId &&
      activity.turnId === latestTurnId &&
      (latestOfTurn === null || comparePlanActivities(activity, latestOfTurn) > 0)
    ) {
      latestOfTurn = activity;
    }
  }
  const chosen = latestOfTurn ?? latest;
  if (chosen === null) return null;
  const steps = taskListStepsFromPayload(chosen.payload);
  return steps && steps.length > 0 ? steps : null;
}
