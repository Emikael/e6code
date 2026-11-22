import { describe, expect, it } from "vite-plus/test";

import {
  ByteCounters,
  DelayQueue,
  linkSettings,
  type ProxyClock,
  ShapedLink,
  throughputMbps,
  TokenBucket,
} from "./throttleProxy.ts";

/** A clock the test moves by hand; due timers run in deadline order, ties in insertion order. */
function manualClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>();
  const clock: ProxyClock = {
    now: () => now,
    setTimeout: (run, ms) => {
      nextId += 1;
      timers.set(nextId, { at: now + ms, run });
      return nextId;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advanceTo = (target: number) => {
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .toSorted((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
    }
    now = target;
  };
  return { clock, advanceTo, pendingTimers: () => timers.size };
}

describe("linkSettings", () => {
  it("splits the round trip into one-way latency and converts megabits to bytes per ms", () => {
    expect(linkSettings({ rttMs: 60, mbps: 20, burstMs: 4 })).toEqual({
      latencyMs: 30,
      bytesPerMs: 2500,
      burstBytes: 10_000,
    });
  });
});

describe("TokenBucket", () => {
  it("lets a burst through at once, then paces at the refill rate", () => {
    const bucket = new TokenBucket({ bytesPerMs: 1, burstBytes: 10 });
    expect(bucket.reserve(0, 10)).toBe(0);
    expect(bucket.reserve(0, 10)).toBe(10);
    expect(bucket.reserve(0, 5)).toBe(15);
  });

  it("refills while idle, up to the burst", () => {
    const bucket = new TokenBucket({ bytesPerMs: 1, burstBytes: 10 });
    bucket.reserve(0, 10);
    expect(bucket.reserve(1_000, 10)).toBe(1_000);
    expect(bucket.reserve(1_000, 1)).toBe(1_001);
  });

  it("holds the long-run rate for chunks larger than the burst", () => {
    const bucket = new TokenBucket({ bytesPerMs: 1, burstBytes: 10 });
    expect(bucket.reserve(0, 30)).toBe(0);
    expect(bucket.reserve(0, 1)).toBe(21);
  });

  it("never releases a later chunk before an earlier one", () => {
    const bucket = new TokenBucket({ bytesPerMs: 1, burstBytes: 1 });
    expect(bucket.reserve(50, 1)).toBe(50);
    expect(bucket.reserve(10, 1)).toBe(51);
  });
});

describe("ShapedLink", () => {
  it("adds one-way latency after the bucket releases a chunk", () => {
    const link = new ShapedLink({
      latencyMs: 30,
      bucket: new TokenBucket({ bytesPerMs: 2500, burstBytes: 10_000 }),
    });
    // A full bucket lets 100 KB leave at once and owes the other 90 KB: 36 ms at 2,500 bytes/ms.
    expect(link.deliveryTime(0, 100_000)).toBe(30);
    // The next 2.5 KB waits for that debt and its own 1 ms.
    expect(link.deliveryTime(0, 2_500)).toBe(30 + 37);
  });

  it("delivers immediately in passthrough", () => {
    const link = new ShapedLink({ latencyMs: 0, bucket: null });
    expect(link.deliveryTime(5, 10_000_000)).toBe(5);
  });
});

describe("DelayQueue", () => {
  it("delivers each item at its time, in the order pushed", () => {
    const { clock, advanceTo } = manualClock();
    const delivered: Array<string> = [];
    const queue = new DelayQueue<string>({ clock, deliver: (item) => delivered.push(item) });
    queue.push("a", 30);
    queue.push("b", 30);
    queue.push("c", 60);
    advanceTo(29);
    expect(delivered).toEqual([]);
    advanceTo(30);
    expect(delivered).toEqual(["a", "b"]);
    advanceTo(60);
    expect(delivered).toEqual(["a", "b", "c"]);
    expect(queue.pending).toBe(0);
  });

  it("holds an item scheduled earlier than the one before it until that one goes", () => {
    const { clock, advanceTo } = manualClock();
    const delivered: Array<string> = [];
    const queue = new DelayQueue<string>({ clock, deliver: (item) => delivered.push(item) });
    queue.push("first", 40);
    queue.push("second", 10);
    advanceTo(10);
    expect(delivered).toEqual([]);
    advanceTo(40);
    expect(delivered).toEqual(["first", "second"]);
  });

  it("delivers an item that is already due without waiting for a timer", () => {
    const { clock, pendingTimers } = manualClock();
    const delivered: Array<string> = [];
    const queue = new DelayQueue<string>({ clock, deliver: (item) => delivered.push(item) });
    queue.push("now", 0);
    expect(delivered).toEqual(["now"]);
    expect(pendingTimers()).toBe(0);
  });

  it("drops what is queued when closed", () => {
    const { clock, advanceTo, pendingTimers } = manualClock();
    const delivered: Array<string> = [];
    const queue = new DelayQueue<string>({ clock, deliver: (item) => delivered.push(item) });
    queue.push("late", 30);
    queue.close();
    advanceTo(100);
    expect(delivered).toEqual([]);
    expect(pendingTimers()).toBe(0);
  });
});

describe("ByteCounters", () => {
  it("totals bytes per connection and per direction", () => {
    const counters = new ByteCounters();
    counters.add(1, "clientToServer", 100);
    counters.add(1, "serverToClient", 1_000);
    counters.add(2, "serverToClient", 50);
    counters.add(1, "serverToClient", 24);
    expect(counters.totals()).toEqual({ clientToServer: 100, serverToClient: 1_074 });
    expect(counters.connections()).toEqual([
      { id: 1, clientToServer: 100, serverToClient: 1_024 },
      { id: 2, clientToServer: 0, serverToClient: 50 },
    ]);
  });
});

describe("throughputMbps", () => {
  it("measures from the first byte's arrival, so the first chunk does not count", () => {
    // 2.5 MB after the first 64 KB chunk, over one second: 20 Mbps.
    expect(
      throughputMbps({
        totalBytes: 2_500_000 + 65_536,
        firstChunkBytes: 65_536,
        firstByteMs: 100,
        lastByteMs: 1_100,
      }),
    ).toBeCloseTo(20, 6);
  });

  it("has no value without a measurable span", () => {
    expect(
      throughputMbps({ totalBytes: 10, firstChunkBytes: 10, firstByteMs: 5, lastByteMs: 5 }),
    ).toBeNull();
  });
});
