import { describe, expect, it } from "vite-plus/test";

import {
  DIGEST_IDLE_BREAKPOINT_MS,
  DIGEST_MAX_HOLD_MS,
  formatWorkedDuration,
  groupThreadDeliveries,
  nextDigestFlushAtMs,
  resolveThreadNotificationDelivery,
  isFocusHoldActive,
  selectHeldForFlush,
  threadNotificationBody,
  type ThreadNotificationContext,
} from "./threadNotificationPolicy";

const standard = {
  attentionNotifications: "blocked",
  notifyWatchedThreads: true,
  holdFinishedUntilBreakpoint: true,
} as const;

function deliver(overrides: Partial<ThreadNotificationContext>) {
  return resolveThreadNotificationDelivery({
    event: "blocked",
    windowFocused: true,
    anotherWindowFocused: false,
    systemNotificationsAvailable: true,
    isOpenThread: false,
    watched: false,
    focusHold: false,
    settings: standard,
    ...overrides,
  });
}

describe("resolveThreadNotificationDelivery", () => {
  // The F2 delivery table: unfocused / focused on another thread / focused on the same thread.
  it.each([
    ["blocked", false, "os", "toast", "none"],
    ["watched", true, "os", "digest", "none"],
    ["other", false, "digest", "digest", "none"],
  ] as const)("delivers %s finishes per the table", (row, watched, unfocused, other, same) => {
    const event = row === "blocked" ? "blocked" : "finished";
    expect(deliver({ event, watched, windowFocused: false })).toBe(unfocused);
    expect(deliver({ event, watched })).toBe(other);
    expect(deliver({ event, watched, isOpenThread: true })).toBe(same);
  });

  it("still sends a system notification for the open thread when the window is away", () => {
    expect(deliver({ isOpenThread: true, windowFocused: false })).toBe("os");
    expect(
      deliver({ event: "finished", watched: true, isOpenThread: true, windowFocused: false }),
    ).toBe("os");
  });

  it("notifies every finished thread at once with all", () => {
    const settings = { ...standard, attentionNotifications: "all" } as const;
    expect(deliver({ event: "finished", settings, windowFocused: false })).toBe("os");
    expect(deliver({ event: "finished", settings })).toBe("toast");
  });

  it("notifies nothing with off", () => {
    const settings = { ...standard, attentionNotifications: "off" } as const;
    expect(deliver({ settings, windowFocused: false })).toBe("none");
    expect(deliver({ event: "finished", watched: true, settings, windowFocused: false })).toBe(
      "none",
    );
  });

  it("treats a watched thread as unwatched when the setting is off", () => {
    const settings = { ...standard, notifyWatchedThreads: false } as const;
    expect(deliver({ event: "finished", watched: true, settings, windowFocused: false })).toBe(
      "digest",
    );
  });

  it("shows finished threads at once when holding is off, but never as a system notification", () => {
    const settings = { ...standard, holdFinishedUntilBreakpoint: false } as const;
    expect(deliver({ event: "finished", settings })).toBe("toast");
    expect(deliver({ event: "finished", watched: true, settings })).toBe("toast");
    expect(deliver({ event: "finished", settings, windowFocused: false })).toBe("digest");
  });

  it("holds other finished threads in focus mode, but lets blocked and the focused thread through", () => {
    const settings = { ...standard, attentionNotifications: "all" } as const;
    expect(deliver({ event: "finished", watched: true, focusHold: true })).toBe("digest");
    expect(deliver({ event: "finished", settings, focusHold: true, windowFocused: false })).toBe(
      "digest",
    );
    expect(deliver({ focusHold: true })).toBe("toast");
    expect(deliver({ focusHold: true, windowFocused: false })).toBe("os");
    expect(
      deliver({
        event: "finished",
        watched: true,
        focusHold: true,
        isOpenThread: true,
        windowFocused: false,
      }),
    ).toBe("os");
  });
});

describe("without system notifications", () => {
  const unavailable = { systemNotificationsAvailable: false, windowFocused: false } as const;

  it("holds a blocked agent for your return instead of dropping it", () => {
    expect(deliver(unavailable)).toBe("held");
    expect(deliver({ ...unavailable, isOpenThread: true })).toBe("held");
  });

  it("holds watched and every-update finishes with the digest", () => {
    const all = { ...standard, attentionNotifications: "all" } as const;
    expect(deliver({ ...unavailable, event: "finished", watched: true })).toBe("digest");
    expect(deliver({ ...unavailable, event: "finished", settings: all })).toBe("digest");
  });

  it("changes nothing while the window has focus", () => {
    expect(deliver({ systemNotificationsAvailable: false })).toBe("toast");
  });
});

describe("with another window focused", () => {
  it("leaves the notice to the focused window", () => {
    const away = { windowFocused: false, anotherWindowFocused: true } as const;
    expect(deliver(away)).toBe("none");
    expect(deliver({ ...away, event: "finished", watched: true })).toBe("none");
    expect(deliver({ ...away, event: "finished" })).toBe("none");
  });

  it("still delivers in the focused window", () => {
    expect(deliver({ anotherWindowFocused: true })).toBe("toast");
  });
});

describe("selectHeldForFlush", () => {
  const notice = (
    key: string,
    kind: "approval" | "completion",
    heldAtMs: number,
    watched = false,
  ) => ({ key, kind, heldAtMs, watched });
  const none = new Map<string, number>();

  it("gives blocked and watched items their own toast and digests the rest, oldest first", () => {
    const held = [
      notice("c", "completion", 30),
      notice("a", "approval", 10),
      notice("w", "completion", 20, true),
      notice("d", "completion", 5),
    ];
    const result = selectHeldForFlush(held, {
      openThreadKey: null,
      visitedAtMsByKey: none,
      focusHold: false,
      isStillBlocked: () => true,
    });
    expect(result.own.map((item) => item.key)).toEqual(["a", "w"]);
    expect(result.digest.map((item) => item.key)).toEqual(["d", "c"]);
    expect(result.keep).toEqual([]);
  });

  it("drops what you have open, or opened after it was held", () => {
    const held = [
      notice("open", "approval", 10),
      notice("seen", "completion", 10),
      notice("before", "completion", 10),
    ];
    const result = selectHeldForFlush(held, {
      openThreadKey: "open",
      visitedAtMsByKey: new Map([
        ["seen", 15],
        ["before", 5],
      ]),
      focusHold: false,
      isStillBlocked: () => true,
    });
    expect(result.own).toEqual([]);
    expect(result.digest.map((item) => item.key)).toEqual(["before"]);
  });

  it("keeps finishes in focus mode but lets blocked items through", () => {
    const held = [notice("a", "approval", 1), notice("w", "completion", 2, true)];
    const result = selectHeldForFlush(held, {
      openThreadKey: null,
      visitedAtMsByKey: none,
      focusHold: true,
      isStillBlocked: () => true,
    });
    expect(result.own.map((item) => item.key)).toEqual(["a"]);
    expect(result.keep.map((item) => item.key)).toEqual(["w"]);
  });

  it("drops a held approval that was answered elsewhere", () => {
    const held = [notice("answered", "approval", 1), notice("waiting", "approval", 2)];
    const result = selectHeldForFlush(held, {
      openThreadKey: null,
      visitedAtMsByKey: none,
      focusHold: false,
      isStillBlocked: (key) => key === "waiting",
    });
    expect(result.own.map((item) => item.key)).toEqual(["waiting"]);
    expect(result.keep).toEqual([]);
  });
});

describe("isFocusHoldActive", () => {
  it("holds only while focus is showing a thread and the setting is on", () => {
    const on = { focusMode: true, focusHoldsFinished: true, openThreadKey: "env:t" };
    expect(isFocusHoldActive(on)).toBe(true);
    // Settings, the start screen and drafts have no open thread: focus waits there.
    expect(isFocusHoldActive({ ...on, openThreadKey: null })).toBe(false);
    expect(isFocusHoldActive({ ...on, focusHoldsFinished: false })).toBe(false);
    expect(isFocusHoldActive({ ...on, focusMode: false })).toBe(false);
  });
});

describe("groupThreadDeliveries", () => {
  it("joins several finishes delivered the same way into one", () => {
    const groups = groupThreadDeliveries([
      { notice: { id: 1, kind: "completion" as const }, delivery: "toast" },
      { notice: { id: 2, kind: "approval" as const }, delivery: "toast" },
      { notice: { id: 3, kind: "completion" as const }, delivery: "toast" },
      { notice: { id: 4, kind: "completion" as const }, delivery: "os" },
    ]);
    expect(groups.map((group) => [group.delivery, group.notices.map((n) => n.id)])).toEqual([
      ["toast", [2]],
      ["toast", [1, 3]],
      ["os", [4]],
    ]);
  });
});

describe("nextDigestFlushAtMs", () => {
  it("waits for 20 seconds without input", () => {
    expect(
      nextDigestFlushAtMs({ oldestHeldAtMs: 1_000, lastInputAtMs: 5_000, focusHold: false }),
    ).toBe(5_000 + DIGEST_IDLE_BREAKPOINT_MS);
  });

  it("counts the pause from the hold when input was older", () => {
    expect(nextDigestFlushAtMs({ oldestHeldAtMs: 9_000, lastInputAtMs: 0, focusHold: false })).toBe(
      9_000 + DIGEST_IDLE_BREAKPOINT_MS,
    );
  });

  it("never holds longer than 5 minutes while you keep typing", () => {
    expect(
      nextDigestFlushAtMs({
        oldestHeldAtMs: 0,
        lastInputAtMs: DIGEST_MAX_HOLD_MS - 1_000,
        focusHold: false,
      }),
    ).toBe(DIGEST_MAX_HOLD_MS);
  });

  it("holds until exit in focus mode, and has nothing to do when empty", () => {
    expect(nextDigestFlushAtMs({ oldestHeldAtMs: 0, lastInputAtMs: 0, focusHold: true })).toBe(
      null,
    );
    expect(nextDigestFlushAtMs({ oldestHeldAtMs: null, lastInputAtMs: 0, focusHold: false })).toBe(
      null,
    );
  });
});

describe("threadNotificationBody", () => {
  const label = (name: string) => ({ codex: "Codex" })[name];
  const thread = {
    title: "Fix tunnel reconnect loop",
    session: { providerName: "codex", lastError: null },
    latestTurn: { startedAt: "2026-09-13T10:00:00.000Z", completedAt: "2026-09-13T10:03:40.000Z" },
  };

  it("adds one fact to the thread title", () => {
    expect(threadNotificationBody(thread, "approval", label)).toBe(
      "Fix tunnel reconnect loop · Codex is waiting for your approval",
    );
    expect(threadNotificationBody(thread, "completion", label)).toBe(
      "Fix tunnel reconnect loop · worked 3m 40s",
    );
  });

  it("names the failure's first line, shortened", () => {
    const failed = {
      ...thread,
      session: { providerName: "codex", lastError: `the CLI is not signed in\n${"x".repeat(300)}` },
    };
    expect(threadNotificationBody(failed, "failed", label)).toBe(
      "Fix tunnel reconnect loop · Codex stopped: the CLI is not signed in",
    );
    const long = { ...thread, session: { providerName: "codex", lastError: "y".repeat(300) } };
    expect(threadNotificationBody(long, "failed", label).length).toBeLessThan(170);
  });

  it("falls back to the agent, and to the title alone without times", () => {
    const bare = { title: "T", session: null, latestTurn: null };
    expect(threadNotificationBody(bare, "input", label)).toBe("T · The agent asked you a question");
    expect(threadNotificationBody(bare, "completion", label)).toBe("T");
  });

  it.each([
    [45_000, "45s"],
    [180_000, "3m"],
    [3_900_000, "1h 5m"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatWorkedDuration(ms)).toBe(text);
  });
});
