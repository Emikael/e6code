// @effect-diagnostics globalDate:off globalTimers:off -- React screens read this clock outside an Effect runtime.
const MINUTE_MS = 60_000;

const floorToMinute = (ms: number) => ms - (ms % MINUTE_MS);

interface MinuteClockTimers {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

const SYSTEM_TIMERS: MinuteClockTimers = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * One clock for every "resets in 3h 12m" label, outside React so a screen
 * with several countdowns still runs a single timer. It ticks on minute
 * boundaries only while something subscribes; idle, a read returns the
 * current minute, so a label that mounts paused is never stale.
 */
export function createMinuteClock(timers: MinuteClockTimers = SYSTEM_TIMERS) {
  const listeners = new Set<() => void>();
  let handle: unknown = null;
  let current = floorToMinute(timers.now());

  const schedule = () => {
    const now = timers.now();
    handle = timers.setTimeout(tick, MINUTE_MS - (now % MINUTE_MS));
  };
  const tick = () => {
    current = floorToMinute(timers.now());
    schedule();
    for (const listener of listeners) listener();
  };

  return {
    /** Start-of-minute epoch milliseconds. */
    getSnapshot: (): number => {
      if (handle === null) current = floorToMinute(timers.now());
      return current;
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      if (handle === null) {
        current = floorToMinute(timers.now());
        schedule();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && handle !== null) {
          timers.clearTimeout(handle);
          handle = null;
        }
      };
    },
  };
}

export const minuteClock = createMinuteClock();
