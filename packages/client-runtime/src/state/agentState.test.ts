import { describe, expect, it } from "vite-plus/test";
import { agentStateLabelTicks, formatAgentStateLabel } from "./agentState.ts";

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
