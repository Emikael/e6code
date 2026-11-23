/**
 * The harness's stop switch. The SIGINT/SIGTERM trap sets it before it awaits
 * anything; from then on nothing new starts. `spawnLogged` checks it before
 * every child process, so the trap's one pass over the running children sees
 * them all, and the browser, OTLP sink and throttle proxies start through
 * `start`, which closes one that finished starting after the stop.
 *
 * @module perf-harness/stopLatch
 */

export class HarnessStoppedError extends Error {}

export class StopLatch {
  #reason: string | null = null;

  get stopped(): boolean {
    return this.#reason !== null;
  }

  /** Records the stop; `true` only for the first request. */
  request(reason: string): boolean {
    if (this.#reason !== null) return false;
    this.#reason = reason;
    return true;
  }

  /** Throws `HarnessStoppedError` once a stop was requested. */
  check(what: string): void {
    if (this.#reason !== null) {
      throw new HarnessStoppedError(`${this.#reason}: not starting ${what}`);
    }
  }

  /** Starts `what` unless stopped; disposes it and throws if a stop arrived while it started. */
  async start<A>(
    what: string,
    start: () => Promise<A>,
    dispose: (started: A) => Promise<unknown>,
  ): Promise<A> {
    this.check(what);
    const started = await start();
    if (this.#reason !== null) {
      await dispose(started);
      this.check(what);
    }
    return started;
  }
}

/** The one latch of this harness process. */
export const harnessStop = new StopLatch();
