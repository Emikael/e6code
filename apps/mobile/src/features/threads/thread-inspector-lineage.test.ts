import {
  deriveAgentPanelModel,
  emptyAgentPanelModel,
  type RuntimeSubagent,
} from "@e6tools/client-runtime/state/subagentRuntime";
import { describe, expect, it } from "vite-plus/test";

import { deriveInspectorLineage, subagentSessionIsLive } from "./thread-inspector-lineage";

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

    expect(lineage.label).toBe("Lineage · 1 working · 1 failed · 1 done · 1.5k tok");
  });

  it("is a bare label with no rows when the thread has no subagents", () => {
    expect(deriveInspectorLineage(emptyAgentPanelModel())).toEqual({
      rows: [],
      label: "Lineage",
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
