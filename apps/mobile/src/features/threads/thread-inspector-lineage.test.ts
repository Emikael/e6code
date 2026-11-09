import {
  deriveAgentPanelModel,
  emptyAgentPanelModel,
  type RuntimeSubagent,
} from "@e6tools/client-runtime/state/subagentRuntime";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveInspectorLineage,
  deriveRunDetailsPlanSteps,
  subagentSessionIsLive,
} from "./thread-inspector-lineage";

function agent(
  id: string,
  firstSeenAt: string,
  overrides: Partial<RuntimeSubagent> = {},
): RuntimeSubagent {
  return {
    id,
    kind: "subagent",
    title: id,
    role: null,
    model: null,
    effort: null,
    status: "running",
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    firstSeenAt,
    startedAt: firstSeenAt,
    completedAt: null,
    updatedAt: firstSeenAt,
    ...overrides,
  };
}

function rowsOf(agents: ReadonlyArray<RuntimeSubagent>) {
  return deriveInspectorLineage(deriveAgentPanelModel({ agents })).rows.map((row) =>
    row.kind === "agent" ? `${"  ".repeat(row.depth)}${row.agent.id}` : `  [${row.title}]`,
  );
}

describe("deriveInspectorLineage", () => {
  it("keeps spawn order across direct agents and workflows, with members indented", () => {
    const workflow = agent("wf", "2026-08-01T10:00:02.000Z", {
      kind: "workflow",
      phases: [
        { index: 0, title: "Research" },
        { index: 1, title: "Build" },
      ],
    });
    const member = (id: string, overrides: Partial<RuntimeSubagent>) =>
      agent(id, "2026-08-01T10:00:03.000Z", {
        kind: "workflow_agent",
        parentAgentId: "wf",
        ...overrides,
      });

    expect(
      rowsOf([
        agent("late", "2026-08-01T10:00:09.000Z"),
        member("build-a", { phaseIndex: 1, agentIndex: 0 }),
        member("research-b", { phaseIndex: 0, agentIndex: 1 }),
        member("research-a", { phaseIndex: 0, agentIndex: 0 }),
        member("orphan-phase", { phaseIndex: 7 }),
        workflow,
        agent("early", "2026-08-01T10:00:01.000Z"),
      ]),
    ).toEqual([
      "early",
      "wf",
      "  [Research]",
      "  research-a",
      "  research-b",
      "  [Build]",
      "  build-a",
      "  orphan-phase",
      "late",
    ]);
  });

  it("counts workflow members instead of their coordinator in the label", () => {
    const lineage = deriveInspectorLineage(
      deriveAgentPanelModel({
        agents: [
          agent("wf", "2026-08-01T10:00:00.000Z", { kind: "workflow" }),
          agent("m1", "2026-08-01T10:00:01.000Z", {
            kind: "workflow_agent",
            parentAgentId: "wf",
            status: "completed",
            usage: { totalTokens: 1500 },
          }),
          agent("m2", "2026-08-01T10:00:02.000Z", {
            kind: "workflow_agent",
            parentAgentId: "wf",
          }),
          agent("solo", "2026-08-01T10:00:03.000Z", { status: "failed" }),
        ],
      }),
    );

    expect(lineage.label).toBe("Subagents · 1 working · 1 failed · 1 done · 1.5K tok");
  });

  it("is a bare label with no rows when the thread has no subagents", () => {
    expect(deriveInspectorLineage(emptyAgentPanelModel())).toEqual({
      rows: [],
      label: "Subagents",
    });
  });
});

describe("subagentSessionIsLive", () => {
  it("treats a missing or ended session as unable to finish running agents", () => {
    expect(subagentSessionIsLive(null)).toBe(false);
    expect(subagentSessionIsLive({ status: "stopped" })).toBe(false);
    expect(subagentSessionIsLive({ status: "error" })).toBe(false);
    expect(subagentSessionIsLive({ status: "ready" })).toBe(true);
    expect(subagentSessionIsLive({ status: "running" })).toBe(true);
  });
});

function planActivity(
  id: string,
  turnId: string,
  createdAt: string,
  plan: ReadonlyArray<{ step: string; status: string }>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind: "turn.plan.updated",
    summary: "Plan updated",
    payload: { plan },
    turnId: TurnId.make(turnId),
    createdAt,
  };
}

describe("deriveRunDetailsPlanSteps", () => {
  const earlier = planActivity("p1", "turn-1", "2026-08-01T10:00:00.000Z", [
    { step: "Read code", status: "completed" },
    { step: "Write fix", status: "inProgress" },
  ]);

  it("keeps the latest plan across follow-up turns that publish none", () => {
    expect(deriveRunDetailsPlanSteps([earlier], TurnId.make("turn-2"))).toEqual([
      { step: "Read code", status: "completed" },
      { step: "Write fix", status: "inProgress" },
    ]);
  });

  it("prefers the latest turn's plan over a later plan from another turn", () => {
    const current = planActivity("p2", "turn-2", "2026-08-01T10:01:00.000Z", [
      { step: "Ship", status: "pending" },
    ]);
    const stray = planActivity("p3", "turn-1", "2026-08-01T10:02:00.000Z", [
      { step: "Old", status: "completed" },
    ]);
    expect(deriveRunDetailsPlanSteps([current, stray], TurnId.make("turn-2"))).toEqual([
      { step: "Ship", status: "pending" },
    ]);
  });

  it("shows no plan once the agent clears it", () => {
    const cleared = planActivity("p2", "turn-1", "2026-08-01T10:01:00.000Z", []);
    expect(deriveRunDetailsPlanSteps([cleared, earlier], TurnId.make("turn-1"))).toBeNull();
    expect(deriveRunDetailsPlanSteps([], null)).toBeNull();
  });
});
