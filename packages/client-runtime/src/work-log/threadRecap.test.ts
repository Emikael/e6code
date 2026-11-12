import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "./workLogEntries.ts";
import {
  deriveThreadRecap,
  latestThreadActivityAt,
  RECAP_BREAK_MS,
  selectRecapAsk,
  shouldShowThreadRecap,
  THREAD_DETAIL_ACTIVITY_CAP,
  type RecapCheckpoint,
  type RecapMessage,
} from "./threadRecap.ts";

const at = (minute: number) => `2026-11-11T14:${String(minute).padStart(2, "0")}:00.000Z`;

const message = (id: string, text: string, minute: number, role = "user"): RecapMessage => ({
  id,
  role,
  text,
  createdAt: at(minute),
});

const step = (id: string, minute: number, overrides: Partial<WorkLogEntry> = {}): WorkLogEntry => ({
  id,
  createdAt: at(minute),
  label: "Read file",
  tone: "tool",
  requestKind: "file-read",
  ...overrides,
});

const checkpoint = (
  turnId: string,
  minute: number,
  files: RecapCheckpoint["files"],
): RecapCheckpoint => ({ turnId, completedAt: at(minute), files });

const LONG_ASK = "Switch the default accent to Graphite and keep the built-in themes working.";

describe("shouldShowThreadRecap", () => {
  const base = {
    trigger: "after-break" as const,
    previousVisitAt: at(2),
    latestActivityAt: at(5),
    nowMs: Date.parse(at(2)) + RECAP_BREAK_MS,
  };

  it("shows after a break of five minutes with something new", () => {
    expect(shouldShowThreadRecap(base)).toBe(true);
  });

  it("stays quiet when you were here moments ago", () => {
    expect(shouldShowThreadRecap({ ...base, nowMs: Date.parse(at(2)) + RECAP_BREAK_MS - 1 })).toBe(
      false,
    );
  });

  it("stays quiet when nothing happened since the visit", () => {
    expect(shouldShowThreadRecap({ ...base, latestActivityAt: at(1) })).toBe(false);
    expect(shouldShowThreadRecap({ ...base, latestActivityAt: null })).toBe(false);
  });

  it("needs a previous visit", () => {
    expect(shouldShowThreadRecap({ ...base, previousVisitAt: null })).toBe(false);
  });

  it("follows the setting", () => {
    const soon = { ...base, nowMs: Date.parse(at(3)) };
    expect(shouldShowThreadRecap({ ...soon, trigger: "always" })).toBe(true);
    expect(shouldShowThreadRecap({ ...base, trigger: "never" })).toBe(false);
  });
});

describe("selectRecapAsk", () => {
  it("takes your most recent message of 40 or more characters", () => {
    expect(
      selectRecapAsk([
        message("m1", "Fix it", 1),
        message("m2", LONG_ASK, 2),
        message("m3", "Also update the mobile tokens.", 3),
        message(
          "a1",
          "A long assistant reply that is certainly over forty characters.",
          4,
          "assistant",
        ),
      ]),
    ).toEqual({ messageId: "m2", text: LONG_ASK });
  });

  it("falls back to the thread's first message", () => {
    expect(selectRecapAsk([message("m1", "Fix the relay", 1), message("m2", "go on", 2)])).toEqual({
      messageId: "m1",
      text: "Fix the relay",
    });
  });

  it("is null without a message from you", () => {
    expect(selectRecapAsk([message("a1", "Hello", 1, "assistant")])).toBeNull();
  });
});

describe("deriveThreadRecap", () => {
  const input = {
    since: at(2),
    messages: [message("m1", LONG_ASK, 1)],
    workLogEntries: [] as WorkLogEntry[],
    checkpoints: [] as RecapCheckpoint[],
    provider: "Claude",
    activityCount: 12,
    note: null,
  };

  it("omits rows that have no data", () => {
    expect(deriveThreadRecap(input)).toEqual({
      since: at(2),
      youAsked: { messageId: "m1", text: LONG_ASK },
      sinceThen: null,
      note: null,
    });
    expect(deriveThreadRecap({ ...input, messages: [] })).toBeNull();
  });

  it("summarizes only the steps after the visit, with the files they changed", () => {
    const recap = deriveThreadRecap({
      ...input,
      workLogEntries: [
        step("old", 1),
        step("r1", 3),
        step("r2", 4),
        step("e1", 5, { label: "Edit", requestKind: "file-change", changedFiles: ["a.ts"] }),
      ],
      checkpoints: [
        checkpoint("t0", 1, [{ path: "old.ts", additions: 9, deletions: 9 }]),
        checkpoint("t1", 4, [
          { path: "a.ts", additions: 2, deletions: 1 },
          { path: "b.ts", additions: 18, deletions: 4 },
        ]),
        checkpoint("t2", 6, [
          { path: "a.ts", additions: 1, deletions: 0 },
          { path: "c.ts", additions: 1, deletions: 1 },
          { path: "d.ts", additions: 1, deletions: 0 },
        ]),
      ],
    });
    expect(recap?.sinceThen?.summary).toBe("Claude read 2 files and changed 1 file.");
    expect(recap?.sinceThen?.files).toEqual([
      { path: "b.ts", additions: 18, deletions: 4, turnId: "t1" },
      { path: "a.ts", additions: 3, deletions: 1, turnId: "t2" },
      { path: "c.ts", additions: 1, deletions: 1, turnId: "t2" },
    ]);
    expect(recap?.sinceThen?.moreFiles).toBe(1);
  });

  it("says At least when thread detail hit its activity cap", () => {
    const recap = deriveThreadRecap({
      ...input,
      activityCount: THREAD_DETAIL_ACTIVITY_CAP,
      workLogEntries: [step("r1", 3)],
    });
    expect(recap?.sinceThen?.summary).toBe("At least: Claude read 1 file.");
  });

  it("keeps a note to self", () => {
    expect(deriveThreadRecap({ ...input, messages: [], note: " Check dark mode " })?.note).toBe(
      "Check dark mode",
    );
  });
});

describe("latestThreadActivityAt", () => {
  it("takes the newest message, step or checkpoint", () => {
    expect(
      latestThreadActivityAt({
        messages: [message("m1", "hi", 1)],
        workLogEntries: [step("s", 7)],
        checkpoints: [checkpoint("t", 5, [])],
      }),
    ).toBe(at(7));
    expect(
      latestThreadActivityAt({ messages: [], workLogEntries: [], checkpoints: [] }),
    ).toBeNull();
  });
});
