/**
 * Decides when the soak's load driver starts the next turn on each thread it
 * drives, from the threads `subscribeShell` reports. The shell coalesces
 * updates, so a short turn may never be seen running: a turn has ended when
 * the thread's latest turn is a new turn id in a terminal state and the
 * session no longer runs it. Each ended turn id yields one dispatch, so a
 * repeated upsert never starts two turns. A thread whose turns fail three
 * times in a row is given up rather than spun.
 *
 * @module perf-harness/soakScheduler
 */

export interface ShellThreadView {
  readonly id: string;
  readonly latestTurn: { readonly turnId: string; readonly state: string } | null;
  readonly session: { readonly status: string; readonly activeTurnId: string | null } | null;
}

const MAX_FAILED_TURNS_IN_A_ROW = 3;
const MAX_CYCLE_INTERVAL_MS = 10_000;

/**
 * How often the soak's page clicks the next thread in the sidebar: every
 * 10 s, or more often when that would not reach every thread. The first
 * click is at the start, so `threads` clicks fit inside `durationMs`.
 */
export function soakCycleIntervalMs(durationMs: number, threads: number): number {
  return threads > 0
    ? Math.min(MAX_CYCLE_INTERVAL_MS, durationMs / threads)
    : MAX_CYCLE_INTERVAL_MS;
}

interface Driven {
  readonly kind: string;
  lastTurnId: string | null;
  /** Set while a dispatched turn has not ended: the turn id it must differ from. */
  awaiting: { readonly baselineTurnId: string | null; readonly sinceMs: number } | null;
  dispatched: number;
  completed: number;
  interrupted: number;
  errors: number;
  errorsInARow: number;
  dispatchFailures: number;
  lastDispatchError: string | null;
  lastEndedAtMs: number | null;
  gaveUp: boolean;
}

export class SoakTurnScheduler {
  readonly #threads = new Map<string, Driven>();
  #stopped = false;

  constructor(threads: ReadonlyArray<{ readonly threadId: string; readonly kind: string }>) {
    for (const { threadId, kind } of threads) {
      this.#threads.set(threadId, {
        kind,
        lastTurnId: null,
        awaiting: null,
        dispatched: 0,
        completed: 0,
        interrupted: 0,
        errors: 0,
        errorsInARow: 0,
        dispatchFailures: 0,
        lastDispatchError: null,
        lastEndedAtMs: null,
        gaveUp: false,
      });
    }
  }

  #arm(thread: Driven, nowMs: number): void {
    thread.awaiting = { baselineTurnId: thread.lastTurnId, sinceMs: nowMs };
    thread.dispatched += 1;
  }

  /** Arms every driven thread; returns the threads to dispatch a first turn on. */
  start(nowMs: number): Array<string> {
    const ids: Array<string> = [];
    for (const [threadId, thread] of this.#threads) {
      this.#arm(thread, nowMs);
      ids.push(threadId);
    }
    return ids;
  }

  /** Reads one shell thread; returns its id when its next turn should be dispatched now. */
  observe(view: ShellThreadView, nowMs: number): string | null {
    const thread = this.#threads.get(view.id);
    if (thread === undefined || view.latestTurn === null) return null;
    const { turnId, state } = view.latestTurn;
    thread.lastTurnId = turnId;
    const awaiting = thread.awaiting;
    if (awaiting === null || turnId === awaiting.baselineTurnId || state === "running") return null;
    if (view.session?.status === "running" && view.session.activeTurnId === turnId) return null;
    thread.awaiting = null;
    thread.lastEndedAtMs = nowMs;
    if (state === "completed") thread.completed += 1;
    else if (state === "interrupted") thread.interrupted += 1;
    else thread.errors += 1;
    thread.errorsInARow = state === "error" ? thread.errorsInARow + 1 : 0;
    if (thread.errorsInARow >= MAX_FAILED_TURNS_IN_A_ROW) thread.gaveUp = true;
    if (this.#stopped || thread.gaveUp) return null;
    this.#arm(thread, nowMs);
    return view.id;
  }

  /** The dispatch for `threadId` was rejected; it waits until `retry`. */
  dispatchFailed(threadId: string, message: string): void {
    const thread = this.#threads.get(threadId);
    if (thread === undefined) return;
    thread.awaiting = null;
    thread.dispatchFailures += 1;
    thread.lastDispatchError = message;
  }

  /** Re-arms a thread whose dispatch failed; false when it should not be dispatched. */
  retry(threadId: string, nowMs: number): boolean {
    const thread = this.#threads.get(threadId);
    if (thread === undefined || thread.awaiting !== null || thread.gaveUp || this.#stopped) {
      return false;
    }
    this.#arm(thread, nowMs);
    return true;
  }

  stop(): void {
    this.#stopped = true;
  }

  /** Threads whose dispatched turn has not ended for longer than `limitMs`. */
  stalled(nowMs: number, limitMs: number): Array<string> {
    return [...this.#threads.entries()]
      .filter(([, thread]) => thread.awaiting !== null && nowMs - thread.awaiting.sinceMs > limitMs)
      .map(([threadId]) => threadId);
  }

  summary(): Record<
    string,
    Omit<Driven, "awaiting" | "lastTurnId" | "errorsInARow"> & { readonly waiting: boolean }
  > {
    return Object.fromEntries(
      [...this.#threads.entries()].map(([threadId, thread]) => {
        const { awaiting, lastTurnId: _lastTurnId, errorsInARow: _errorsInARow, ...rest } = thread;
        return [threadId, { ...rest, waiting: awaiting !== null }];
      }),
    );
  }
}
