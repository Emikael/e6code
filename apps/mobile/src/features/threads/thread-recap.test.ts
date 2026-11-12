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

import { decodeThreadVisit, type ThreadVisit } from "../../persistence/thread-visits";
import { decideThreadRecap, formatRecapFiles, formatRecapSince } from "./thread-recap";

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
    const base = { detail, nowMs: Date.parse(at(40)), provider: "Claude", note: null };
    expect(decideThreadRecap({ ...base, previous: null })).toBeNull();
    expect(decideThreadRecap({ ...base, previous: visit(38) })).toBeNull();
    expect(decideThreadRecap({ ...base, previous: { ...visit(2), seenActivityAt: at(35) } })).toBe(
      null,
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
  });

  it("names a clock time today and a day before that", () => {
    const visited = new Date(2026, 10, 11, 14, 2).toISOString();
    expect(formatRecapSince(visited, new Date(2026, 10, 11, 18, 0).getTime())).toMatch(/02/);
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
