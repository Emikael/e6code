// @effect-diagnostics globalDate:off -- "Today" is the device's own calendar day.
import type { EnvironmentId, OrchestrationThreadShell } from "@e6tools/contracts";

import { scopedThreadKey, scopeThreadRef } from "../environment/scoped.ts";

/**
 * "Done today" (F9): what got finished since local midnight, as a plain list.
 * Nothing is counted, scored or compared with other days.
 *
 * A thread is in it when it was settled or archived today, or its latest turn
 * completed today. The shell carries only the latest turn and no file names, so each
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
  /** The latest of today's settle, archive and finished turn. */
  readonly doneAt: string;
  /** Which of the three `doneAt` is. */
  readonly how: "settled" | "archived" | "finished";
  readonly diffStat: { readonly insertions: number; readonly deletions: number } | null;
  /** A pull request linked to the thread and merged today, newest merge first. */
  readonly mergedPullRequest: { readonly number: number; readonly mergedAt: string } | null;
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
  startOfDayMs: number,
): DoneTodayRow<DoneTodayShell>["mergedPullRequest"] {
  let best: { number: number; mergedAt: string; ms: number } | null = null;
  for (const link of links) {
    if (link.source === "stack-dismissed" || link.snapshot?.state !== "merged") continue;
    const mergedAt = link.snapshot.mergedAt ?? null;
    const ms = msOrNull(mergedAt);
    // A merge from an earlier day, or one with no time, does not belong in today's list.
    if (mergedAt === null || ms === null || ms < startOfDayMs) continue;
    if (!best || ms > best.ms) best = { number: link.number, mergedAt, ms };
  }
  return best ? { number: best.number, mergedAt: best.mergedAt } : null;
}

/**
 * Threads done since `startOfDayMs`, newest first, one row per thread.
 * Turns that failed or were stopped are left out, and so are threads archived
 * before today; a thread returned to the active list keeps a turn it finished
 * today.
 */
export function selectDoneToday<T extends DoneTodayShell>(
  threads: ReadonlyArray<T>,
  options: { readonly startOfDayMs: number },
): ReadonlyArray<DoneTodayRow<T>> {
  const { startOfDayMs } = options;
  const today = (ms: number | null): number | null =>
    ms !== null && ms >= startOfDayMs ? ms : null;
  const rows: Array<DoneTodayRow<T> & { readonly doneMs: number }> = [];
  for (const thread of threads) {
    const archivedMs = msOrNull(thread.archivedAt);
    if (thread.archivedAt !== null && today(archivedMs) === null) continue;
    const turn = thread.latestTurn;
    // Latest first; on a tie the earlier entry names the row.
    const events = [
      {
        how: "settled" as const,
        ms: today(thread.settledOverride === "active" ? null : msOrNull(thread.settledAt)),
      },
      { how: "archived" as const, ms: today(archivedMs) },
      {
        how: "finished" as const,
        ms: today(turn?.state === "completed" ? msOrNull(turn.completedAt) : null),
      },
    ];
    let done: { how: DoneTodayRow<T>["how"]; ms: number } | null = null;
    for (const event of events) {
      if (event.ms !== null && (done === null || event.ms > done.ms)) {
        done = { how: event.how, ms: event.ms };
      }
    }
    if (!done) continue;
    rows.push({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      thread,
      doneAt: new Date(done.ms).toISOString(),
      how: done.how,
      diffStat: turn?.diffStat ?? null,
      mergedPullRequest: mergedPullRequest(thread.pullRequests, startOfDayMs),
      doneMs: done.ms,
    });
  }
  rows.sort((left, right) => right.doneMs - left.doneMs || left.key.localeCompare(right.key));
  return rows.map(({ doneMs: _doneMs, ...row }) => row);
}
