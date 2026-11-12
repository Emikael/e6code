// @effect-diagnostics globalDate:off -- "Today" is the device's own calendar day.
import type { EnvironmentId, OrchestrationThreadShell } from "@e6tools/contracts";

import { scopedThreadKey, scopeThreadRef } from "../environment/scoped.ts";

/**
 * "Done today" (F9): what got finished since local midnight, as a plain list.
 * Nothing is counted, scored or compared with other days.
 *
 * A thread is in it when it was settled today, or its latest turn completed
 * today. The shell carries only the latest turn and no file names, so each
 * thread is one row, with that turn's line totals and no file count.
 */
export type DoneTodayShell = Pick<
  OrchestrationThreadShell,
  | "id"
  | "title"
  | "projectId"
  | "archivedAt"
  | "settledOverride"
  | "settledAt"
  | "latestTurn"
  | "pullRequests"
> & { readonly environmentId: EnvironmentId };

export interface DoneTodayRow<T extends DoneTodayShell> {
  /** `scopedThreadKey`, unique across environments. */
  readonly key: string;
  readonly thread: T;
  /** The later of today's settle and today's finished turn. */
  readonly doneAt: string;
  /** Which of the two `doneAt` is. */
  readonly how: "settled" | "finished";
  readonly diffStat: { readonly insertions: number; readonly deletions: number } | null;
  /** A merged pull request linked to the thread, newest merge first. */
  readonly mergedPullRequest: { readonly number: number; readonly mergedAt: string | null } | null;
}

/** Local midnight at the start of the day that contains `nowMs`. */
export function localStartOfDayMs(nowMs: number): number {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function msOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function mergedPullRequest(
  links: DoneTodayShell["pullRequests"],
): DoneTodayRow<DoneTodayShell>["mergedPullRequest"] {
  let best: { number: number; mergedAt: string | null; ms: number } | null = null;
  for (const link of links) {
    if (link.source === "stack-dismissed" || link.snapshot?.state !== "merged") continue;
    const mergedAt = link.snapshot.mergedAt ?? null;
    const ms = msOrNull(mergedAt) ?? Number.NEGATIVE_INFINITY;
    if (!best || ms > best.ms) best = { number: link.number, mergedAt, ms };
  }
  return best ? { number: best.number, mergedAt: best.mergedAt } : null;
}

/**
 * Threads done since `startOfDayMs`, newest first, one row per thread.
 * Archived threads and turns that failed or were stopped are left out; a
 * thread returned to the active list keeps a turn it finished today.
 */
export function selectDoneToday<T extends DoneTodayShell>(
  threads: ReadonlyArray<T>,
  options: { readonly startOfDayMs: number },
): ReadonlyArray<DoneTodayRow<T>> {
  const rows: Array<DoneTodayRow<T> & { readonly doneMs: number }> = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const settledMs = thread.settledOverride === "active" ? null : msOrNull(thread.settledAt);
    const turn = thread.latestTurn;
    const finishedMs = turn?.state === "completed" ? msOrNull(turn.completedAt) : null;
    const settledToday = settledMs !== null && settledMs >= options.startOfDayMs;
    const finishedToday = finishedMs !== null && finishedMs >= options.startOfDayMs;
    if (!settledToday && !finishedToday) continue;
    const how =
      settledToday && (!finishedToday || (settledMs ?? 0) >= (finishedMs ?? 0))
        ? "settled"
        : "finished";
    const doneMs = how === "settled" ? (settledMs ?? 0) : (finishedMs ?? 0);
    rows.push({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      thread,
      doneAt: new Date(doneMs).toISOString(),
      how,
      diffStat: turn?.diffStat ?? null,
      mergedPullRequest: mergedPullRequest(thread.pullRequests),
      doneMs,
    });
  }
  rows.sort((left, right) => right.doneMs - left.doneMs || left.key.localeCompare(right.key));
  return rows.map(({ doneMs: _doneMs, ...row }) => row);
}
