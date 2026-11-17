import { describe, expect, it } from "vite-plus/test";

import {
  BoundedNames,
  FRAME_BYTE_BOUNDARIES,
  FixedHistogram,
  IntervalRing,
  OTHERS_KEY,
  PerformanceInterval,
  eventLoopRollup,
  mergeIntervals,
  rpcTotals,
  shellSummary,
  sqliteTotals,
  topRpcMethods,
  topSqliteStatements,
} from "./PerformanceAggregates.ts";

describe("FixedHistogram", () => {
  it("places a value equal to a boundary in that boundary's bucket", () => {
    const histogram = new FixedHistogram([10, 20, 50]);
    histogram.record(10);
    histogram.record(10.0001);
    histogram.record(50);
    histogram.record(51);
    expect(Array.from(histogram.counts)).toEqual([1, 1, 1, 1]);
    expect(histogram.count).toBe(4);
    expect(histogram.max).toBe(51);
    expect(histogram.sum).toBeCloseTo(121.0001);
  });

  it("counts values strictly above a budget threshold exactly", () => {
    const histogram = new FixedHistogram(FRAME_BYTE_BOUNDARIES);
    for (const bytes of [100, 4096, 4097, 262144, 262145, 5_000_000]) histogram.record(bytes);
    expect(histogram.countAbove(4096)).toBe(4);
    expect(histogram.countAbove(262144)).toBe(2);
  });

  it("reports a quantile as at most its bucket bound, capped by the exact max", () => {
    const histogram = new FixedHistogram([1, 2, 5, 10]);
    for (let index = 0; index < 95; index++) histogram.record(0.5);
    for (let index = 0; index < 5; index++) histogram.record(7);
    expect(histogram.quantileAtMost(0.5)).toBe(1);
    expect(histogram.quantileAtMost(0.95)).toBe(1);
    expect(histogram.quantileAtMost(0.96)).toBe(7);
    expect(histogram.quantileAtMost(0.99)).toBe(7);
  });

  it("uses the exact max for ranks in the overflow bucket and 0 when empty", () => {
    const histogram = new FixedHistogram([1, 2]);
    expect(histogram.quantileAtMost(0.99)).toBe(0);
    histogram.record(1);
    histogram.record(300);
    expect(histogram.quantileAtMost(0.99)).toBe(300);
  });

  it("merges counts, sums and max", () => {
    const left = new FixedHistogram([1, 2]);
    const right = new FixedHistogram([1, 2]);
    left.record(1);
    right.record(2);
    right.record(9);
    left.mergeFrom(right);
    expect(Array.from(left.counts)).toEqual([1, 1, 1]);
    expect(left.count).toBe(3);
    expect(left.sum).toBe(12);
    expect(left.max).toBe(9);
  });
});

describe("PerformanceInterval", () => {
  it("splits stream chunks from unary exits per method", () => {
    const interval = new PerformanceInterval(0);
    interval.recordFrame("orchestration.subscribeThread", "chunk", 1000, 3);
    interval.recordFrame("orchestration.subscribeThread", "chunk", 5000, 1);
    interval.recordFrame("orchestration.subscribeThread", "exit", 40, 0);
    interval.recordFrame("server.getConfig", "exit", 300, 0);

    const [thread, config] = topRpcMethods(interval, 10);
    expect(thread).toEqual({
      method: "orchestration.subscribeThread",
      chunkFrames: 2,
      chunkValues: 4,
      chunkBytes: 6000,
      exitFrames: 1,
      exitBytes: 40,
      maxFrameBytes: 5000,
      p95FrameBytesAtMost: 5000,
      framesOver4KiB: 1,
      framesOver256KiB: 0,
    });
    expect(config?.method).toBe("server.getConfig");
    expect(rpcTotals(interval)).toMatchObject({ frames: 4, bytes: 6340, maxFrameBytes: 5000 });
  });

  it("records statement time and failures per statement name", () => {
    const interval = new PerformanceInterval(0);
    interval.recordStatement("SELECT projection_threads#abc123", 0.4, true);
    interval.recordStatement("SELECT projection_threads#abc123", 12, false);
    interval.recordStatement("INSERT orchestration_events#def456", 1, true);

    expect(topSqliteStatements(interval, 10)).toEqual([
      {
        name: "SELECT projection_threads#abc123",
        count: 2,
        failures: 1,
        totalMs: 12.4,
        maxMs: 12,
        p95MsAtMost: 12,
      },
      {
        name: "INSERT orchestration_events#def456",
        count: 1,
        failures: 0,
        totalMs: 1,
        maxMs: 1,
        p95MsAtMost: 1,
      },
    ]);
    expect(sqliteTotals(interval)).toEqual({
      count: 3,
      totalMs: 13.4,
      maxMs: 12,
      failures: 1,
      statements: 2,
    });
  });

  it("counts shell refetches per coalescing window by source", () => {
    const interval = new PerformanceInterval(0);
    interval.recordShellWindow("live", 30, 2);
    interval.recordShellWindow("live", 4, 4);
    interval.recordShellWindow("catch-up", 21, 9);
    // One read recovered on retry; one failed twice and was dropped.
    interval.recordShellFailedRead();
    interval.recordShellFailedRead();
    interval.recordShellFailedRead();
    interval.recordShellFailure();

    expect(shellSummary(interval)).toEqual({
      windows: 3,
      inputEvents: 55,
      liveRefetches: 6,
      catchUpRefetches: 9,
      retries: 2,
      failures: 1,
      maxRefetchesPerWindow: 9,
      p95RefetchesPerWindowAtMost: 9,
    });
  });

  it("keeps totals exact when rows beyond the limit fold into an others row", () => {
    const interval = new PerformanceInterval(0);
    interval.recordStatement("a", 30, true);
    interval.recordStatement("b", 20, true);
    interval.recordStatement("c", 5, false);
    interval.recordStatement("d", 1, true);

    const rows = topSqliteStatements(interval, 2);
    expect(rows.map((row) => row.name)).toEqual(["a", "b", OTHERS_KEY]);
    expect(rows[2]).toMatchObject({ count: 2, failures: 1, totalMs: 6, maxMs: 5 });
    expect(rows.reduce((total, row) => total + row.totalMs, 0)).toBe(
      sqliteTotals(interval).totalMs,
    );
  });

  it("merges intervals into one view without changing the sources", () => {
    const first = new PerformanceInterval(1_000);
    first.recordFrame("m", "chunk", 100, 1);
    first.recordStatement("s", 2, true);
    first.recordShellWindow("live", 1, 1);
    first.endedAtMs = 11_000;
    const second = new PerformanceInterval(11_000);
    second.recordFrame("m", "exit", 50, 0);
    second.recordStatement("s", 3, false);
    second.recordShellWindow("live", 2, 1);
    second.endedAtMs = 21_000;

    const merged = mergeIntervals([first, second], 0);
    expect(merged.startedAtMs).toBe(1_000);
    expect(merged.endedAtMs).toBe(21_000);
    expect(rpcTotals(merged)).toMatchObject({ frames: 2, bytes: 150 });
    expect(sqliteTotals(merged)).toMatchObject({ count: 2, totalMs: 5, failures: 1 });
    expect(shellSummary(merged)).toMatchObject({ windows: 2, liveRefetches: 2 });
    expect(rpcTotals(first)).toMatchObject({ frames: 1, bytes: 100 });
  });
});

describe("IntervalRing", () => {
  it("evicts the oldest interval beyond capacity and returns the newest in order", () => {
    const ring = new IntervalRing(3);
    for (let index = 0; index < 5; index++) ring.push(new PerformanceInterval(index));
    expect(ring.latest().map((interval) => interval.startedAtMs)).toEqual([2, 3, 4]);
    expect(ring.latest(2).map((interval) => interval.startedAtMs)).toEqual([3, 4]);
  });
});

describe("BoundedNames", () => {
  it("pools names past capacity under the overflow key and counts them", () => {
    const names = new BoundedNames(2, "other");
    expect(names.admit("a")).toBe("a");
    expect(names.admit("b")).toBe("b");
    expect(names.admit("a")).toBe("a");
    expect(names.admit("c")).toBe("other");
    expect(names.admit("d")).toBe("other");
    expect(names.size).toBe(2);
    expect(names.overflowed).toBe(2);
  });
});

describe("eventLoopRollup", () => {
  const sample = (p99Ms: number, maxMs: number) => ({
    endedAtMs: 0,
    p50Ms: 0,
    p99Ms,
    maxMs,
    rawP50Ms: 0,
    rawP99Ms: 0,
    rawMaxMs: 0,
    utilization: 0,
    samples: 1,
  });

  it("reports the worst window p99 and the overall max", () => {
    expect(eventLoopRollup([sample(3, 40), sample(25, 30), sample(1, 2)])).toEqual({
      worstP99Ms: 25,
      maxMs: 40,
    });
    expect(eventLoopRollup([])).toBeNull();
  });
});
