import { describe, expect, it } from "vite-plus/test";

import {
  diffPinState,
  newerChangeCount,
  pinnedDiffMessage,
  stillWorkingLabel,
} from "./diffPin.logic";

describe("diffPinState", () => {
  it("follows the newest diff while no agent works", () => {
    expect(diffPinState({ agentRunning: false, appliedRevision: "a", liveRevision: "b" })).toBe(
      "live",
    );
  });

  it("holds the applied diff while the agent works and a newer one arrives", () => {
    expect(diffPinState({ agentRunning: true, appliedRevision: "a", liveRevision: "b" })).toBe(
      "pinned",
    );
    expect(diffPinState({ agentRunning: true, appliedRevision: "a", liveRevision: null })).toBe(
      "pinned",
    );
  });

  it("stays live while the agent works and nothing newer arrived", () => {
    expect(diffPinState({ agentRunning: true, appliedRevision: "a", liveRevision: "a" })).toBe(
      "live",
    );
  });

  it("shows the first diff to arrive", () => {
    expect(diffPinState({ agentRunning: true, appliedRevision: null, liveRevision: "a" })).toBe(
      "live",
    );
  });
});

describe("newerChangeCount", () => {
  const stat = (path: string, additions = 1, deletions = 0) => ({ path, additions, deletions });

  it("counts added, removed and recounted files", () => {
    expect(
      newerChangeCount(
        [stat("a.ts"), stat("b.ts"), stat("c.ts")],
        [stat("a.ts"), stat("b.ts", 4), stat("d.ts")],
      ),
    ).toBe(3);
  });

  it("is null without per-file counts", () => {
    expect(newerChangeCount(undefined, [stat("a.ts")])).toBeNull();
  });
});

describe("words", () => {
  it("says how many changes wait", () => {
    expect(pinnedDiffMessage(2)).toBe(
      "2 newer changes are not shown, so nothing moves while you read.",
    );
    expect(pinnedDiffMessage(1)).toBe(
      "1 newer change is not shown, so nothing moves while you read.",
    );
    expect(pinnedDiffMessage(null)).toBe(
      "Newer changes are not shown, so nothing moves while you read.",
    );
  });

  it("names a known provider", () => {
    expect(stillWorkingLabel("claudeAgent")).toBe("Claude is still working");
    expect(stillWorkingLabel(null)).toBe("The agent is still working");
  });
});
