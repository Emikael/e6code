import { describe, expect, it } from "vite-plus/test";

import { createMinuteClock } from "./minuteClock.ts";

function fakeTimers(startMs: number) {
  let nowMs = startMs;
  const pending = new Map<number, { readonly at: number; readonly callback: () => void }>();
  let nextHandle = 1;
  return {
    timers: {
      now: () => nowMs,
      setTimeout: (callback: () => void, delayMs: number) => {
        const handle = nextHandle++;
        pending.set(handle, { at: nowMs + delayMs, callback });
        return handle;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    pendingCount: () => pending.size,
    advanceTo(targetMs: number) {
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= targetMs)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        nowMs = due[1].at;
        due[1].callback();
      }
      nowMs = targetMs;
    },
  };
}

describe("createMinuteClock", () => {
  it("ticks on minute boundaries only while subscribed", () => {
    const fake = fakeTimers(Date.UTC(2026, 0, 1, 10, 0, 45));
    const clock = createMinuteClock(fake.timers);
    expect(fake.pendingCount()).toBe(0);

    const seen: number[] = [];
    const unsubscribe = clock.subscribe(() => seen.push(clock.getSnapshot()));
    expect(clock.getSnapshot()).toBe(Date.UTC(2026, 0, 1, 10, 0));

    // The first tick lands at the next boundary, not a full minute later.
    fake.advanceTo(Date.UTC(2026, 0, 1, 10, 1, 0));
    fake.advanceTo(Date.UTC(2026, 0, 1, 10, 2, 30));
    expect(seen).toEqual([Date.UTC(2026, 0, 1, 10, 1), Date.UTC(2026, 0, 1, 10, 2)]);

    unsubscribe();
    expect(fake.pendingCount()).toBe(0);
    fake.advanceTo(Date.UTC(2026, 0, 1, 10, 5, 0));
    expect(seen).toHaveLength(2);
  });

  it("reads the current minute while idle and shares one timer", () => {
    const fake = fakeTimers(Date.UTC(2026, 0, 1, 10, 0, 0));
    const clock = createMinuteClock(fake.timers);
    fake.advanceTo(Date.UTC(2026, 0, 1, 12, 7, 5));
    expect(clock.getSnapshot()).toBe(Date.UTC(2026, 0, 1, 12, 7));

    const first = clock.subscribe(() => {});
    const second = clock.subscribe(() => {});
    expect(fake.pendingCount()).toBe(1);
    first();
    expect(fake.pendingCount()).toBe(1);
    second();
    expect(fake.pendingCount()).toBe(0);
  });
});
