import { EnvironmentId, ThreadId, TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatAttentionAge,
  isThreadFailed,
  nextNeedsYouTarget,
  selectSnoozedThreads,
  selectThreadAttention,
  selectThreadsToSnoozeExcept,
  type ThreadAttentionShell,
} from "./threadAttention.ts";

const NOW = "2026-04-10T12:00:00.000Z";
const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

function shell(
  id: string,
  overrides: Partial<ThreadAttentionShell> & {
    readonly sessionStatus?: "starting" | "running" | "ready" | "error";
    readonly turn?: { state: "running" | "completed" | "error" | "interrupted"; at: string };
  } = {},
): ThreadAttentionShell {
  const { sessionStatus, turn, ...rest } = overrides;
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    environmentId: LOCAL,
    archivedAt: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    updatedAt: "2026-04-10T11:00:00.000Z",
    session:
      sessionStatus === undefined
        ? null
        : {
            threadId,
            status: sessionStatus,
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-04-10T11:00:00.000Z",
          },
    latestTurn:
      turn === undefined
        ? null
        : {
            turnId: TurnId.make(`turn-${id}`),
            state: turn.state,
            requestedAt: "2026-04-10T10:00:00.000Z",
            startedAt: "2026-04-10T10:00:00.000Z",
            completedAt: turn.state === "running" ? null : turn.at,
            assistantMessageId: null,
          },
    ...rest,
  };
}

const select = (
  threads: ReadonlyArray<ThreadAttentionShell>,
  visits: Record<string, string> = {},
) => selectThreadAttention(threads, { now: NOW, lastVisitedAt: (key) => visits[key] });
const ids = (items: ReadonlyArray<{ readonly thread: ThreadAttentionShell }>) =>
  items.map((item) => item.thread.id);

describe("selectThreadAttention", () => {
  it("puts approval, answer and failed in Blocked, plan and unseen done in To review", () => {
    const result = select(
      [
        shell("done", { sessionStatus: "ready", turn: { state: "completed", at: NOW } }),
        shell("failed", { sessionStatus: "error", turn: { state: "error", at: NOW } }),
        shell("plan", {
          hasActionableProposedPlan: true,
          interactionMode: "plan",
          sessionStatus: "ready",
          turn: { state: "completed", at: NOW },
        }),
        shell("input", { hasPendingUserInput: true }),
        shell("approval", { hasPendingApprovals: true }),
        shell("idle"),
      ],
      { "local:done": "2026-04-10T09:00:00.000Z", "local:plan": NOW },
    );
    expect(ids(result.blocked)).toEqual(["approval", "input", "failed"]);
    expect(ids(result.review)).toEqual(["plan", "done"]);
    expect(result.blockedCount).toBe(3);
  });

  it("orders each kind oldest request first, so rows never reshuffle as time passes", () => {
    const result = select([
      shell("newer", {
        hasPendingApprovals: true,
        pendingRequestSince: "2026-04-10T11:50:00.000Z",
      }),
      shell("older", {
        hasPendingApprovals: true,
        pendingRequestSince: "2026-04-10T11:10:00.000Z",
      }),
    ]);
    expect(ids(result.blocked)).toEqual(["older", "newer"]);
  });

  it("falls back to updatedAt when an older server sends no request time", () => {
    const [item] = select([
      shell("a", { hasPendingUserInput: true, updatedAt: "2026-04-10T11:30:00.000Z" }),
    ]).blocked;
    expect(item?.since).toBe("2026-04-10T11:30:00.000Z");
  });

  it("leaves out snoozed, settled and archived threads, and wakes when the snooze ends", () => {
    const result = select([
      shell("snoozed", {
        sessionStatus: "error",
        snoozedAt: "2026-04-10T11:00:00.000Z",
        snoozedUntil: "2026-04-10T15:00:00.000Z",
      }),
      shell("settled", { sessionStatus: "error", settledOverride: "settled" }),
      shell("archived", { hasPendingApprovals: true, archivedAt: NOW }),
    ]);
    expect(result.blocked).toEqual([]);
    expect(result.blockedCount).toBe(0);
    expect(result.nextChangeAtMs).toBe(Date.parse("2026-04-10T15:00:00.000Z"));
  });

  it("folds blocked threads older than 24 hours into Earlier, still counted", () => {
    const result = select([
      shell("stale", {
        hasPendingApprovals: true,
        pendingRequestSince: "2026-04-09T11:00:00.000Z",
      }),
      shell("fresh", {
        hasPendingApprovals: true,
        pendingRequestSince: "2026-04-10T11:00:00.000Z",
      }),
    ]);
    expect(ids(result.blocked)).toEqual(["fresh"]);
    expect(ids(result.earlier)).toEqual(["stale"]);
    expect(result.blockedCount).toBe(2);
    expect(result.nextChangeAtMs).toBe(Date.parse("2026-04-11T11:00:00.000Z"));
  });

  it("does not report a finish as unseen without a visit on this device", () => {
    const done = shell("done", { sessionStatus: "ready", turn: { state: "completed", at: NOW } });
    expect(select([done]).review).toEqual([]);
  });

  it("keys threads by environment, so equal ids on two servers stay apart", () => {
    const result = select([
      shell("same", { hasPendingApprovals: true }),
      shell("same", { hasPendingApprovals: true, environmentId: REMOTE }),
    ]);
    expect(result.blocked.map((item) => item.key)).toEqual(["local:same", "remote:same"]);
  });
});

describe("isThreadFailed", () => {
  it("reads a failed turn or session as failed until a new run starts", () => {
    expect(isThreadFailed(shell("a", { sessionStatus: "error" }))).toBe(true);
    expect(
      isThreadFailed(shell("a", { sessionStatus: "ready", turn: { state: "error", at: NOW } })),
    ).toBe(true);
    expect(
      isThreadFailed(shell("a", { sessionStatus: "running", turn: { state: "error", at: NOW } })),
    ).toBe(false);
  });
});

describe("formatAttentionAge", () => {
  it("counts whole minutes, then hours, then names the day", () => {
    expect(formatAttentionAge("2026-04-10T11:59:30.000Z", NOW)).toBe("now");
    expect(formatAttentionAge("2026-04-10T11:56:00.000Z", NOW)).toBe("4m");
    expect(formatAttentionAge("2026-04-10T10:55:00.000Z", NOW)).toBe("1h 5m");
    expect(formatAttentionAge("2026-04-08T12:00:00.000Z", NOW)).toMatch(/^since /);
  });
});

describe("nextNeedsYouTarget", () => {
  const attention = select([
    shell("approval", { hasPendingApprovals: true }),
    shell("failed", { sessionStatus: "error" }),
    shell("plan", {
      hasActionableProposedPlan: true,
      interactionMode: "plan",
      sessionStatus: "ready",
      turn: { state: "completed", at: NOW },
    }),
  ]);
  const next = (current: string | null) => nextNeedsYouTarget(attention, current)?.thread.id;

  it("walks Blocked, then To review, and wraps", () => {
    expect(next(null)).toBe("approval");
    expect(next("local:approval")).toBe("failed");
    expect(next("local:failed")).toBe("plan");
    expect(next("local:plan")).toBe("approval");
  });

  it("skips the open thread and starts at the top from anywhere else", () => {
    expect(next("local:idle")).toBe("approval");
    const onlyOpen = select([shell("approval", { hasPendingApprovals: true })]);
    expect(nextNeedsYouTarget(onlyOpen, "local:approval")).toBeNull();
  });

  it("is empty when nothing needs you", () => {
    expect(nextNeedsYouTarget(select([shell("idle")]), null)).toBeNull();
  });
});

describe("snooze everything except this thread", () => {
  const withMessage = (thread: ThreadAttentionShell) => ({ ...thread, latestUserMessageAt: null });

  it("snoozes the rest, never the kept thread or one blocked on you, and wakes them again", () => {
    const threads = [
      withMessage(shell("keep")),
      withMessage(shell("other", { sessionStatus: "ready" })),
      withMessage(shell("blocked", { hasPendingApprovals: true })),
      withMessage(shell("settled", { settledOverride: "settled" })),
    ];
    const toSnooze = selectThreadsToSnoozeExcept(threads, { exceptKey: "local:keep", now: NOW });
    expect(toSnooze.map((thread) => thread.id)).toEqual(["other"]);

    const asleep = threads.map((thread) =>
      thread.id === "other"
        ? { ...thread, snoozedAt: NOW, snoozedUntil: "2026-04-11T09:00:00.000Z" }
        : thread,
    );
    expect(selectSnoozedThreads(asleep, { now: NOW }).map((thread) => thread.id)).toEqual([
      "other",
    ]);
  });
});
