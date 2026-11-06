import type { OrchestrationSession } from "@e6tools/contracts";
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
  /** Section label: "Lineage · 3 working · 1 done", plus tokens once known. */
  readonly label: string;
}

/**
 * Flattens the panel model into the Inspector's lineage list. Top-level rows
 * keep spawn order; a workflow is followed by its members, phase by phase,
 * then any members whose phase is unknown. The label counts the members of a
 * workflow instead of its coordinator, matching the web Overview.
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
    "Lineage",
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
  if (liveCount <= 0) return "Open overview";
  return `Open overview, ${liveCount} ${liveCount === 1 ? "subagent" : "subagents"} running`;
}
