// @effect-diagnostics globalDate:off -- Ages are read on the device against its own clock.
import type { EnvironmentId, OrchestrationThreadShell } from "@e6tools/contracts";

import { scopedThreadKey, scopeThreadRef } from "../environment/scoped.ts";
import { canSnooze, effectiveSnoozed, type ThreadSnoozeShell } from "./threadSettled.ts";

/**
 * "What is waiting on me?" as one derived list, shared by every client.
 *
 * Blocked: an agent cannot continue without the user (approval, answer) or
 * the run broke (failed). Counted in badges.
 * To review: a plan is ready, or a finished turn the user has not seen yet.
 * Not counted.
 *
 * Snoozed, settled and archived threads are never in either tier. Order is
 * fixed by kind, then oldest first, so rows enter and leave as time passes
 * but never reshuffle.
 */
export type ThreadAttentionKind = "approval" | "input" | "failed" | "plan" | "done";
export type ThreadAttentionTier = "blocked" | "review";

const KIND_ORDER: Readonly<Record<ThreadAttentionKind, number>> = {
  approval: 0,
  input: 1,
  failed: 2,
  plan: 3,
  done: 4,
};

/** Blocked rows older than this fold into one "Earlier" row. */
const THREAD_ATTENTION_STALE_MS = 24 * 60 * 60 * 1_000;

export type ThreadAttentionShell = Pick<
  OrchestrationThreadShell,
  | "id"
  | "archivedAt"
  | "settledOverride"
  | "snoozedUntil"
  | "snoozedAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingRequestSince"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "session"
  | "latestTurn"
  | "updatedAt"
> & { readonly environmentId: EnvironmentId };

export interface ThreadAttentionItem<T extends ThreadAttentionShell> {
  /** `scopedThreadKey`, unique across environments. */
  readonly key: string;
  readonly thread: T;
  readonly kind: ThreadAttentionKind;
  readonly tier: ThreadAttentionTier;
  /** When the thread started waiting: the oldest request, or the turn's end. */
  readonly since: string;
}

export interface ThreadAttention<T extends ThreadAttentionShell> {
  /** Blocked within the last 24 hours, in display order. */
  readonly blocked: ReadonlyArray<ThreadAttentionItem<T>>;
  /** Blocked for longer than 24 hours, folded into one "Earlier" row. */
  readonly earlier: ReadonlyArray<ThreadAttentionItem<T>>;
  readonly review: ReadonlyArray<ThreadAttentionItem<T>>;
  /** Every blocked thread, the earlier ones included: the badge count. */
  readonly blockedCount: number;
  /**
   * The next time the result changes without new data (a snooze wakes or a
   * blocked row turns 24 hours old), in epoch ms, or null. Callers schedule a
   * single recompute for then instead of re-deriving on a clock.
   */
  readonly nextChangeAtMs: number | null;
}

/**
 * The one "failed" rule: the session errored, or the latest turn ended in
 * an error, and nothing is running now. A live session hides an older
 * failure because the agent is already trying again.
 */
export function isThreadFailed(
  thread: Pick<OrchestrationThreadShell, "session"> & {
    readonly latestTurn?: OrchestrationThreadShell["latestTurn"] | undefined;
  },
): boolean {
  const status = thread.session?.status;
  if (status === "running" || status === "starting") return false;
  return status === "error" || thread.latestTurn?.state === "error";
}

function isLatestTurnSettled(thread: Pick<OrchestrationThreadShell, "session" | "latestTurn">) {
  const turn = thread.latestTurn;
  if (!turn?.startedAt || !turn.completedAt) return false;
  return thread.session?.status !== "running";
}

/**
 * The attention kind of one thread, or null when it is not waiting on the
 * user. `lastVisitedAt` is this device's last visit; without one a finished
 * turn is not reported as unseen, matching the sidebar's unread rule.
 */
function resolveThreadAttentionKind(
  thread: ThreadAttentionShell,
  lastVisitedAt: string | null | undefined,
): ThreadAttentionKind | null {
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  if (isThreadFailed(thread)) return "failed";
  if (
    thread.hasActionableProposedPlan &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread)
  ) {
    return "plan";
  }
  const turn = thread.latestTurn;
  const status = thread.session?.status;
  if (
    turn?.state === "completed" &&
    turn.completedAt &&
    status !== "running" &&
    status !== "starting" &&
    lastVisitedAt
  ) {
    const completedMs = Date.parse(turn.completedAt);
    const visitedMs = Date.parse(lastVisitedAt);
    if (!Number.isNaN(completedMs) && (Number.isNaN(visitedMs) || completedMs > visitedMs)) {
      return "done";
    }
  }
  return null;
}

function attentionSince(thread: ThreadAttentionShell, kind: ThreadAttentionKind): string {
  if (kind === "approval" || kind === "input") {
    // Older servers do not send the request time.
    return thread.pendingRequestSince ?? thread.updatedAt;
  }
  return thread.latestTurn?.completedAt ?? thread.updatedAt;
}

function timeMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function compareItems<T extends ThreadAttentionShell>(
  left: ThreadAttentionItem<T>,
  right: ThreadAttentionItem<T>,
): number {
  return (
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    timeMs(left.since) - timeMs(right.since) ||
    left.key.localeCompare(right.key)
  );
}

export function selectThreadAttention<T extends ThreadAttentionShell>(
  threads: ReadonlyArray<T>,
  options: {
    readonly now: string;
    /** This device's last visit per `scopedThreadKey`; omit where visits are not tracked. */
    readonly lastVisitedAt?: (key: string) => string | null | undefined;
  },
): ThreadAttention<T> {
  const nowMs = Date.parse(options.now);
  const blocked: ThreadAttentionItem<T>[] = [];
  const earlier: ThreadAttentionItem<T>[] = [];
  const review: ThreadAttentionItem<T>[] = [];
  let nextChangeAtMs = Number.POSITIVE_INFINITY;
  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.settledOverride === "settled") continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const kind = resolveThreadAttentionKind(thread, options.lastVisitedAt?.(key));
    if (kind === null) continue;
    if (effectiveSnoozed(thread, { now: options.now })) {
      const wakeMs = Date.parse(thread.snoozedUntil ?? "");
      if (!Number.isNaN(wakeMs)) nextChangeAtMs = Math.min(nextChangeAtMs, wakeMs);
      continue;
    }
    const since = attentionSince(thread, kind);
    if (kind === "plan" || kind === "done") {
      review.push({ key, thread, kind, tier: "review", since });
      continue;
    }
    const item = { key, thread, kind, tier: "blocked" as const, since };
    const staleAtMs = Date.parse(since) + THREAD_ATTENTION_STALE_MS;
    if (staleAtMs <= nowMs) {
      earlier.push(item);
    } else {
      blocked.push(item);
      if (!Number.isNaN(staleAtMs)) nextChangeAtMs = Math.min(nextChangeAtMs, staleAtMs);
    }
  }
  blocked.sort(compareItems);
  earlier.sort(compareItems);
  review.sort(compareItems);
  return {
    blocked,
    earlier,
    review,
    blockedCount: blocked.length + earlier.length,
    nextChangeAtMs: Number.isFinite(nextChangeAtMs) ? nextChangeAtMs : null,
  };
}

/**
 * Whole-minute age for thread lists: "now", "4m", "1h 5m". Past a day it
 * names the day ("since Tue") instead of a growing number. No seconds, so
 * nothing ticks at the edge of the eye.
 */
export function formatAttentionAge(since: string, now: string): string {
  const sinceMs = Date.parse(since);
  const nowMs = Date.parse(now);
  if (Number.isNaN(sinceMs) || Number.isNaN(nowMs)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) {
    const rest = minutes % 60;
    return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
  }
  const date = new Date(sinceMs);
  const withinWeek = nowMs - sinceMs < 7 * THREAD_ATTENTION_STALE_MS;
  return `since ${date.toLocaleDateString(
    undefined,
    withinWeek ? { weekday: "short" } : { month: "short", day: "numeric" },
  )}`;
}

/**
 * How long something has run, for elapsed cues (a working row): "<1m" in the
 * first minute, as boards 1 and 8 draw it, else as {@link formatAttentionAge}.
 * A request's age keeps "now" ("asked just now").
 */
export function formatElapsedAge(since: string, now: string): string {
  const age = formatAttentionAge(since, now);
  return age === "now" ? "<1m" : age;
}

/**
 * A request's age for a screen reader: "just now", "12 minutes ago",
 * "2 hours 5 minutes ago", or past a day "since Tue".
 */
export function describeAttentionAgeSpoken(since: string, now: string): string {
  const age = formatAttentionAge(since, now);
  if (age === "" || age.startsWith("since ")) return age;
  if (age === "now") return "just now";
  const units = { h: "hour", m: "minute" } as const;
  const words = age.split(" ").map((part) => {
    const count = Number(part.slice(0, -1));
    const unit = units[part.slice(-1) as keyof typeof units];
    return `${count} ${unit}${count === 1 ? "" : "s"}`;
  });
  return `${words.join(" ")} ago`;
}

/**
 * Where "Go to next thread that needs you" lands: Blocked (Earlier
 * included), then To review, starting after the open thread and wrapping.
 * The open thread itself is skipped; null when nothing else is waiting.
 * `scope: "blocked"` walks Blocked and Earlier only, for a control that
 * counts only those (focus mode's "1 needs you · Next"), so the count and
 * the walk agree.
 */
export function nextNeedsYouTarget<T extends ThreadAttentionShell>(
  attention: Pick<ThreadAttention<T>, "blocked" | "earlier" | "review">,
  currentKey: string | null,
  options: { readonly scope?: "blocked" | "all" } = {},
): ThreadAttentionItem<T> | null {
  const order = [
    ...attention.blocked,
    ...attention.earlier,
    ...(options.scope === "blocked" ? [] : attention.review),
  ];
  const currentIndex =
    currentKey === null ? -1 : order.findIndex((item) => item.key === currentKey);
  for (let step = 1; step <= order.length; step += 1) {
    const item = order[(currentIndex + step) % order.length];
    if (item && item.key !== currentKey) return item;
  }
  return null;
}

type SnoozeAllShell = ThreadAttentionShell & Pick<OrchestrationThreadShell, "latestUserMessageAt">;

/**
 * "Snooze everything except this thread": every visible thread that can be
 * snoozed, other than the one you keep. Threads blocked on you cannot be
 * snoozed and stay put, so nothing that needs you disappears.
 */
export function selectThreadsToSnoozeExcept<T extends SnoozeAllShell>(
  threads: ReadonlyArray<T>,
  options: { readonly exceptKey: string | null; readonly now: string },
): ReadonlyArray<T> {
  return threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.settledOverride !== "settled" &&
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) !== options.exceptKey &&
      !effectiveSnoozed(thread, { now: options.now }) &&
      canSnooze(thread, { now: options.now }),
  );
}

/** "Wake all snoozed threads": every thread still asleep. */
export function selectSnoozedThreads<T extends ThreadAttentionShell>(
  threads: ReadonlyArray<T>,
  options: { readonly now: string },
): ReadonlyArray<T> {
  return threads.filter(
    (thread) => thread.archivedAt === null && effectiveSnoozed(thread, { now: options.now }),
  );
}

/**
 * Threads still open: not archived, settled or snoozed. The open-thread
 * reminder (F12) counts these; it is information, never a gate on Send.
 */
export function countOpenThreads(
  threads: ReadonlyArray<
    ThreadSnoozeShell & Pick<ThreadAttentionShell, "archivedAt" | "settledOverride">
  >,
  options: { readonly now: string },
): number {
  let count = 0;
  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.settledOverride === "settled") continue;
    if (effectiveSnoozed(thread, options)) continue;
    count += 1;
  }
  return count;
}

/** "5 threads are open." once the count reaches the setting's threshold, else null. */
export function openThreadReminderText(count: number, threshold: "off" | number): string | null {
  if (threshold === "off" || count < threshold) return null;
  return `${count} threads are open.`;
}
