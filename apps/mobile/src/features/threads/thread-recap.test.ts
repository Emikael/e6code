// @effect-diagnostics globalDate:off -- The recap day boundary is the device's own calendar.
import {
  CheckpointRef,
  EnvironmentId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeToolGroup } from "@e6tools/client-runtime/work-log/presentation";

import { formatShortTimestamp } from "../../lib/time";
import { buildThreadFeed } from "../../lib/threadActivity";
import { decodeThreadVisit, type ThreadVisit } from "../../persistence/thread-visits";
import {
  decideThreadRecap,
  describeRecapChanges,
  formatRecapFiles,
  formatRecapSince,
} from "./thread-recap";

const at = (minute: number) => `2026-11-11T14:${String(minute).padStart(2, "0")}:00.000Z`;

const message = (id: string, text: string, minute: number): OrchestrationMessage => ({
  id: MessageId.make(id),
  role: "user",
  text,
  turnId: null,
  streaming: false,
  createdAt: at(minute),
  updatedAt: at(minute),
});

const read = (id: string, minute: number): OrchestrationThreadActivity => ({
  id: EventId.make(id),
  tone: "tool",
  kind: "tool.completed",
  summary: "Read file",
  payload: { itemType: "file_read", requestKind: "file-read", detail: `src/${id}.ts` },
  turnId: TurnId.make("turn-1"),
  createdAt: at(minute),
});

const checkpoint: OrchestrationCheckpointSummary = {
  turnId: TurnId.make("turn-1"),
  checkpointTurnCount: 1,
  checkpointRef: CheckpointRef.make("refs/e6/checkpoints/1"),
  status: "ready",
  assistantMessageId: null,
  completedAt: at(30),
  files: [
    { path: "packages/shared/src/themePalettes.ts", kind: "modified", additions: 18, deletions: 4 },
    { path: "apps/mobile/src/mobileTheme.ts", kind: "modified", additions: 6, deletions: 2 },
  ],
};

const visit = (minute: number): ThreadVisit => ({
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread-1"),
  visitedAt: at(minute),
  seenActivityAt: at(minute),
});

const detail = {
  messages: [message("m1", "Also update the mobile tokens so both apps share them.", 1)],
  activities: [read("a", 20), read("b", 21)],
  checkpoints: [checkpoint],
};

describe("decideThreadRecap", () => {
  it("recaps what changed after a break, from the shared derivation", () => {
    const recap = decideThreadRecap({
      detail,
      previous: visit(2),
      nowMs: Date.parse(at(40)),
      provider: "Claude",
      note: null,
      trigger: "after-break",
    });
    expect(recap?.youAsked?.text).toBe("Also update the mobile tokens so both apps share them.");
    expect(recap?.sinceThen?.summary).toMatch(/^Claude read 2 files/);
    expect(recap?.sinceThen?.files.map((file) => file.path)).toEqual([
      "packages/shared/src/themePalettes.ts",
      "apps/mobile/src/mobileTheme.ts",
    ]);
    expect(recap?.since).toBe(at(2));
  });

  it("stays quiet on a first visit, a quick return, or with nothing new", () => {
    const base = {
      detail,
      nowMs: Date.parse(at(40)),
      provider: "Claude",
      note: null,
      trigger: "after-break" as const,
    };
    expect(decideThreadRecap({ ...base, previous: null })).toBeNull();
    expect(decideThreadRecap({ ...base, previous: visit(38) })).toBeNull();
    expect(decideThreadRecap({ ...base, previous: { ...visit(2), seenActivityAt: at(35) } })).toBe(
      null,
    );
  });
});

describe("recap setting", () => {
  const base = { detail, nowMs: Date.parse(at(40)), provider: "Claude", note: null };
  it("never shows when turned off, and always shows on a quick return when asked", () => {
    expect(decideThreadRecap({ ...base, previous: visit(2), trigger: "never" })).toBeNull();
    expect(decideThreadRecap({ ...base, previous: visit(38), trigger: "after-break" })).toBeNull();
    expect(
      decideThreadRecap({
        ...base,
        previous: { ...visit(19), visitedAt: at(38) },
        trigger: "always",
      }),
    ).not.toBeNull();
  });
});

describe("recap and feed agree", () => {
  it("counts the same steps the feed shows", () => {
    const command: OrchestrationThreadActivity = {
      id: EventId.make("c"),
      tone: "tool",
      kind: "tool.completed",
      summary: "Ran command",
      payload: { itemType: "command_execution", requestKind: "command", detail: "vp test run" },
      turnId: TurnId.make("turn-1"),
      createdAt: at(22),
    };
    const edit: OrchestrationThreadActivity = {
      id: EventId.make("e"),
      tone: "tool",
      kind: "tool.completed",
      summary: "Edited file",
      payload: {
        itemType: "file_change",
        requestKind: "file-change",
        detail: "src/theme.ts",
        changes: [{ path: "src/theme.ts" }],
      },
      turnId: TurnId.make("turn-1"),
      createdAt: at(23),
    };
    const activities = [read("a", 20), read("b", 21), command, edit];
    const thread = { messages: detail.messages, activities };
    const recap = decideThreadRecap({
      detail: { ...detail, activities },
      previous: visit(2),
      nowMs: Date.parse(at(40)),
      provider: "Claude",
      note: null,
      trigger: "after-break",
    });
    const feedSteps = buildThreadFeed(thread).flatMap((entry) =>
      entry.type === "activity-group"
        ? entry.activities.filter((activity) => activity.toolLike)
        : [],
    );
    expect(feedSteps).toHaveLength(4);
    const feedSummary = summarizeToolGroup(feedSteps.map((activity) => activity.workEntry));
    expect(recap?.sinceThen?.summary).toBe(
      `Claude ${feedSummary.charAt(0).toLowerCase()}${feedSummary.slice(1)}.`,
    );
  });
});

describe("recap wording", () => {
  it("lists files by name with their line counts, then the rest", () => {
    expect(
      formatRecapFiles(
        [
          { path: "packages/shared/src/themePalettes.ts", additions: 18, deletions: 4 },
          { path: "mobileTheme.ts", additions: 6, deletions: 2 },
        ],
        0,
      ),
    ).toBe("themePalettes.ts +18 −4 · mobileTheme.ts +6 −2");
    expect(formatRecapFiles([{ path: "a.ts", additions: 1, deletions: 0 }], 2)).toBe(
      "a.ts +1 −0 · +2 more",
    );
    expect(formatRecapFiles([], 0)).toBeNull();
    // A running edit that reported no line counts is named without them.
    expect(
      formatRecapFiles([{ path: "src/a.ts", additions: 0, deletions: 0, counted: false }], 0),
    ).toBe("a.ts");
  });

  it("reads the file line and the Changes so far count from one list", () => {
    expect(describeRecapChanges(null)).toEqual({ fileCount: 0, line: null });
    expect(
      describeRecapChanges({
        files: [{ path: "a.ts", additions: 1, deletions: 0 }],
        moreFiles: 2,
      }),
    ).toEqual({ fileCount: 3, line: "a.ts +1 −0 · +2 more" });
  });

  it("names a clock time today, in the device's hour cycle, and a day before that", () => {
    const visited = new Date(2026, 10, 11, 14, 2).toISOString();
    expect(formatRecapSince(visited, new Date(2026, 10, 11, 18, 0).getTime())).toBe(
      formatShortTimestamp(visited, "locale"),
    );
    // No leading zero on the hour: 9:05, never 09:05.
    const morning = new Date(2026, 10, 11, 9, 5).toISOString();
    expect(formatRecapSince(morning, new Date(2026, 10, 11, 18, 0).getTime())).not.toMatch(/^0/);
    expect(formatRecapSince(visited, new Date(2026, 10, 13, 9, 0).getTime())).toBe(
      new Date(visited).toLocaleDateString(undefined, { weekday: "short" }),
    );
  });
});

describe("decodeThreadVisit", () => {
  it("reads what this version stored and drops anything else", () => {
    expect(decodeThreadVisit(JSON.stringify(visit(2)))).toEqual(visit(2));
    expect(decodeThreadVisit("{")).toBeNull();
    expect(decodeThreadVisit(JSON.stringify({ ...visit(2), visitedAt: "soon" }))).toBeNull();
  });
});
