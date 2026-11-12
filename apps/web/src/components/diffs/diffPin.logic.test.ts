import { describe, expect, it } from "vite-plus/test";

import {
  diffPinState,
  nextAppliedDiffPreview,
  newerChangeCount,
  pinnedDiffMessage,
  stillWorkingLabel,
  userActionAnswer,
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

describe("nextAppliedDiffPreview", () => {
  const older = { revision: "a" };
  const newer = { revision: "b" };

  it("keeps the working tree of the preview it applied when only the status moves", () => {
    const applied = { key: "k", data: older, workingTree: ["a.ts"] };
    expect(
      nextAppliedDiffPreview(applied, {
        key: "k",
        live: older,
        workingTree: ["a.ts", "agent-new.ts"],
        pinState: "live",
        answersUser: false,
      }),
    ).toBe(applied);
  });

  it("so a pin that follows holds the rail and the body at the same moment", () => {
    const applied = { key: "k", data: older, workingTree: ["a.ts"] };
    // The status stream has the agent's new file; the next preview pins the old body.
    const pinned = nextAppliedDiffPreview(applied, {
      key: "k",
      live: newer,
      workingTree: ["a.ts", "agent-new.ts"],
      pinState: "pinned",
      answersUser: false,
    });
    expect(pinned?.workingTree).toEqual(["a.ts"]);
    expect(pinned?.data).toBe(older);
  });

  it("copies the working tree together with a newly applied preview", () => {
    const applied = { key: "k", data: older, workingTree: ["a.ts"] };
    expect(
      nextAppliedDiffPreview(applied, {
        key: "k",
        live: newer,
        workingTree: ["a.ts", "b.ts"],
        pinState: "live",
        answersUser: false,
      }),
    ).toEqual({ key: "k", data: newer, workingTree: ["a.ts", "b.ts"] });
  });

  it("applies the preview that answers the user's own action even while pinned", () => {
    const applied = { key: "k", data: older, workingTree: ["a.ts"] };
    expect(
      nextAppliedDiffPreview(applied, {
        key: "k",
        live: newer,
        workingTree: [],
        pinState: "pinned",
        answersUser: true,
      })?.data,
    ).toBe(newer);
  });
});

describe("userActionAnswer", () => {
  it("waits for the first preview that settled after the action", () => {
    expect(
      userActionAnswer({
        since: 10,
        settledAt: 5,
        pending: false,
        failed: false,
        refreshStarted: true,
      }),
    ).toBeNull();
    expect(
      userActionAnswer({
        since: 10,
        settledAt: 12,
        pending: true,
        failed: false,
        refreshStarted: true,
      }),
    ).toBeNull();
    expect(
      userActionAnswer({
        since: 10,
        settledAt: 12,
        pending: false,
        failed: false,
        refreshStarted: true,
      }),
    ).toBe("answered");
  });

  it("ends when the refresh fails", () => {
    expect(
      userActionAnswer({
        since: 10,
        settledAt: 5,
        pending: false,
        failed: true,
        refreshStarted: true,
      }),
    ).toBe("failed");
  });

  it("is not ended by an error left from before the action's refresh started", () => {
    expect(
      userActionAnswer({
        since: 10,
        settledAt: 5,
        pending: false,
        failed: true,
        refreshStarted: false,
      }),
    ).toBeNull();
  });
});
