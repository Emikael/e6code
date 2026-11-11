import { describe, expect, it } from "vite-plus/test";

import {
  DIGEST_IDLE_BREAKPOINT_MS,
  DIGEST_MAX_HOLD_MS,
  formatWorkedDuration,
  nextDigestFlushAtMs,
  resolveThreadNotificationDelivery,
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
