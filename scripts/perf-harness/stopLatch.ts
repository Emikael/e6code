/**
 * The harness's stop switch. The trap (`trapStops`: SIGINT, SIGTERM, SIGHUP,
 * an uncaught exception or an unhandled rejection) sets it before it awaits
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

/** Exit codes for the trapped signals: 128 plus the signal's number. */
const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;

/**
 * Routes the trapped signals and crashes into one teardown: the latch is set
 * before anything is awaited, `teardown` runs once, and the process exits with
 * the signal's code, or 1 after a crash, whether or not the teardown succeeded.
 * A signal or crash during the teardown only waits for it to finish.
 */
export function trapStops(input: {
  readonly latch: StopLatch;
  readonly events: { on(event: string, listener: (value: unknown) => void): unknown };
  readonly teardown: () => Promise<void>;
  readonly exit: (code: number) => void;
  readonly log: (message: string) => void;
  /** The text of a crash's error as it may appear in the log. */
  readonly describeError: (error: unknown) => string;
}): void {
  const stop = (reason: string, code: number) => {
    if (!input.latch.request(reason)) return;
    input.log(`${reason}: stopping the processes this run started`);
    void input
      .teardown()
      .catch((error: unknown) => input.log(`stopping failed: ${input.describeError(error)}`))
      .finally(() => input.exit(code));
  };
  for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    input.events.on(signal, () => stop(signal, code));
  }
  for (const crash of ["uncaughtException", "unhandledRejection"]) {
    input.events.on(crash, (error) => {
      input.log(`${crash}: ${input.describeError(error)}`);
      stop(crash, 1);
    });
  }
}
