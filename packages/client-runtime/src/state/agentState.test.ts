import { describe, expect, it } from "vite-plus/test";
import {
  agentStateLabelTicks,
  formatAgentStateLabel,
  formatPlanStepPosition,
  formatRunningThreadStatus,
  joinThreadRowStatus,
} from "./agentState.ts";

const NOW = Date.parse("2026-01-01T10:00:00.000Z");

describe("formatAgentStateLabel", () => {
  it("names compaction and retries, with counters only when both are known", () => {
    expect(formatAgentStateLabel({ kind: "compacting" }, NOW)).toBe("Compacting context…");
    expect(formatAgentStateLabel({ kind: "retrying", attempt: 2, maxAttempts: 5 }, NOW)).toBe(
      "Retrying request (2 of 5)…",
    );
    expect(formatAgentStateLabel({ kind: "retrying", attempt: 3 }, NOW)).toBe("Retrying request…");
    expect(formatAgentStateLabel({ kind: "retrying" }, NOW)).toBe("Retrying request…");
  });

  it("counts down to the reset, rounding up to the minute", () => {
    const paused = (resetsAt: string) =>
      formatAgentStateLabel({ kind: "rate-limited", resetsAt }, NOW);
    expect(paused("2026-01-01T11:12:00.000Z")).toBe("Paused for usage limit · resets in 1h 12m");
    expect(paused("2026-01-01T10:00:20.000Z")).toBe("Paused for usage limit · resets in 1m");
    expect(paused("2026-01-03T13:00:00.000Z")).toBe("Paused for usage limit · resets in 2d 3h");
  });

  it("drops the countdown when the reset is unknown, passed or unreadable", () => {
    expect(formatAgentStateLabel({ kind: "rate-limited" }, NOW)).toBe("Paused for usage limit");
    expect(
      formatAgentStateLabel({ kind: "rate-limited", resetsAt: "2026-01-01T09:59:00.000Z" }, NOW),
    ).toBe("Paused for usage limit");
    expect(formatAgentStateLabel({ kind: "rate-limited", resetsAt: "soon" }, NOW)).toBe(
      "Paused for usage limit",
    );
  });

  it("asks for a clock only for a countdown", () => {
    expect(agentStateLabelTicks({ kind: "rate-limited", resetsAt: "2026-01-01T11:00:00Z" })).toBe(
      true,
    );
    expect(agentStateLabelTicks({ kind: "rate-limited" })).toBe(false);
    expect(agentStateLabelTicks({ kind: "retrying", attempt: 1, maxAttempts: 2 })).toBe(false);
  });
});

describe("formatPlanStepPosition", () => {
  it("names the step in progress, capped at the plan length", () => {
    expect(formatPlanStepPosition({ completedSteps: 3, totalSteps: 6 })).toBe("step 4 of 6");
    expect(formatPlanStepPosition({ completedSteps: 0, totalSteps: 2 })).toBe("step 1 of 2");
    expect(formatPlanStepPosition({ completedSteps: 6, totalSteps: 6 })).toBe("step 6 of 6");
  });

  it("is absent without a plan", () => {
    expect(formatPlanStepPosition(null)).toBeNull();
    expect(formatPlanStepPosition(undefined)).toBeNull();
    expect(formatPlanStepPosition({ completedSteps: 0, totalSteps: 0 })).toBeNull();
  });
});

describe("formatRunningThreadStatus", () => {
  const formatResetTime = (resetsAt: string) => (resetsAt === "bad" ? "" : `@${resetsAt}`);
  const row = (
    agentState: Parameters<typeof formatRunningThreadStatus>[0]["agentState"],
    planProgress: Parameters<typeof formatRunningThreadStatus>[0]["planProgress"] = null,
  ) =>
    joinThreadRowStatus(formatRunningThreadStatus({ agentState, planProgress, formatResetTime }));

  it("shows the plan step while plainly working", () => {
    expect(row(undefined, { completedSteps: 3, totalSteps: 6 })).toBe("Working · step 4 of 6");
    expect(row(null)).toBe("Working");
  });

  it("lets the agent state explain a stall instead of the plan step", () => {
    const plan = { completedSteps: 1, totalSteps: 3 };
    expect(row({ kind: "rate-limited", resetsAt: "14:20" }, plan)).toBe("Paused · resets @14:20");
    expect(row({ kind: "retrying", attempt: 2, maxAttempts: 10 }, plan)).toBe("Retrying · 2 of 10");
    expect(row({ kind: "compacting" }, plan)).toBe("Compacting");
  });

  it("drops details it cannot state", () => {
    expect(row({ kind: "rate-limited" })).toBe("Paused");
    expect(row({ kind: "rate-limited", resetsAt: "bad" })).toBe("Paused");
    expect(row({ kind: "retrying", attempt: 2 })).toBe("Retrying");
  });
});
