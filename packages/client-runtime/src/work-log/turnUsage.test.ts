import { EventId, TurnId, type OrchestrationThreadActivity } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendTurnUsage,
  deriveTurnUsageByTurnId,
  describeThreadUsage,
  formatTurnUsage,
} from "./turnUsage.ts";

const activity = (
  overrides: Partial<OrchestrationThreadActivity> & Pick<OrchestrationThreadActivity, "payload">,
): OrchestrationThreadActivity => ({
  id: EventId.make("activity"),
  tone: "info",
  kind: "turn.usage",
  summary: "Turn usage",
  turnId: TurnId.make("turn-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("describeThreadUsage", () => {
  it("shows the summed cost and tokens, marking a sum with any estimate", () => {
    expect(
      describeThreadUsage({ totalTokens: 1_234_000, costUsd: 1.844, costSource: "reported" }),
    ).toEqual({
      cost: "$1.84",
      tokens: "1.23m tokens",
      accessibilityLabel: "This thread cost $1.84, 1.23m tokens",
    });
    expect(
      describeThreadUsage({ totalTokens: 48_600, costUsd: 0.004, costSource: "estimated" }),
    ).toEqual({
      cost: "≈<$0.01",
      tokens: "48.6k tokens",
      accessibilityLabel:
        "This thread cost about <$0.01, approximate because some turns were estimated or reported no cost, 48.6k tokens",
    });
  });

  it("shows tokens alone without a cost, and nothing without usage", () => {
    expect(describeThreadUsage({ totalTokens: 900 })).toEqual({
      cost: null,
      tokens: "900 tokens",
      accessibilityLabel: "This thread used 900 tokens",
    });
    expect(describeThreadUsage({ totalTokens: 0 })).toBeNull();
    expect(describeThreadUsage(undefined)).toBeNull();
  });
});

describe("appendTurnUsage", () => {
  it("adds tokens and the reported cost", () => {
    expect(
      appendTurnUsage("Worked for 22s", {
        totalTokens: 48_600,
        partial: false,
        costUsd: 0.1234,
        costSource: "reported",
      }),
    ).toBe("Worked for 22s · 48.6k tokens · $0.12");
  });

  it("marks an estimated cost and floors sub-cent amounts", () => {
    expect(
      appendTurnUsage("Worked for 3s", {
        totalTokens: 1_250_000,
        partial: false,
        costUsd: 2.5,
        costSource: "estimated",
      }),
    ).toBe("Worked for 3s · 1.25m tokens · ≈$2.50");
    expect(
      appendTurnUsage("Worked for 3s", {
        totalTokens: 900,
        partial: false,
        costUsd: 0.004,
        costSource: "reported",
      }),
    ).toBe("Worked for 3s · 900 tokens · <$0.01");
    expect(appendTurnUsage("Worked", { totalTokens: 999_999, partial: false })).toBe(
      "Worked · 1m tokens",
    );
  });

  it("shows tokens alone when the cost is unknown, and nothing without usage", () => {
    expect(appendTurnUsage("You stopped after 5s", { totalTokens: 1_200, partial: true })).toBe(
      "You stopped after 5s · 1.2k tokens",
    );
    expect(appendTurnUsage("Worked for 5s", undefined)).toBe("Worked for 5s");
  });
});

describe("formatTurnUsage", () => {
  it("formats usage without a label for turns that have no fold row", () => {
    expect(
      formatTurnUsage({
        totalTokens: 48_600,
        costUsd: 0.12,
        costSource: "estimated",
        partial: false,
      }),
    ).toBe("48.6k tokens · ≈$0.12");
    expect(formatTurnUsage({ totalTokens: 0, costUsd: 0.12, partial: false })).toBeNull();
    expect(formatTurnUsage(undefined)).toBeNull();
  });
});

describe("deriveTurnUsageByTurnId", () => {
  it("keys valid usage records by turn and skips everything else", () => {
    const usage = deriveTurnUsageByTurnId([
      activity({ payload: { totalTokens: 10, partial: false } }),
      activity({ turnId: TurnId.make("turn-2"), payload: { totalTokens: "many" } }),
      activity({ turnId: null, payload: { totalTokens: 5, partial: false } }),
      activity({
        kind: "context-window.updated",
        turnId: TurnId.make("turn-3"),
        payload: { totalTokens: 5, partial: false },
      }),
    ]);
    expect([...usage]).toEqual([[TurnId.make("turn-1"), { totalTokens: 10, partial: false }]]);
  });

  it("decodes a record once, so rebuilt maps hold the same values", () => {
    const first = activity({ payload: { totalTokens: 10, partial: false } });
    const unrelated = activity({ kind: "context-window.updated", payload: { usedTokens: 4 } });
    const turnId = TurnId.make("turn-1");

    expect(deriveTurnUsageByTurnId([first, unrelated]).get(turnId)).toBe(
      deriveTurnUsageByTurnId([first]).get(turnId),
    );
  });
});
