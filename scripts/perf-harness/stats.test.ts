import { describe, expect, it } from "vite-plus/test";

import {
  growthSlope,
  p95AtMostFromBuckets,
  p95WithUnreported,
  percentile,
  summarize,
} from "./stats.ts";

describe("percentile", () => {
  it("uses the nearest rank, so the value is always one of the samples", () => {
    const samples = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(samples, 0.5)).toBe(5);
    expect(percentile(samples, 0.95)).toBe(10);
    expect(percentile(samples, 0.9)).toBe(9);
    expect(percentile(samples, 0)).toBe(1);
  });

  it("reads the largest of three samples as their p95", () => {
    expect(percentile([300, 100, 200], 0.95)).toBe(300);
  });

  it("has no value without samples", () => {
    expect(percentile([], 0.95)).toBeNull();
  });
});

describe("summarize", () => {
  it("reports count, extremes and the usual percentiles", () => {
    const summary = summarize([4, 1, 3, 2]);
    expect(summary).toEqual({ count: 4, min: 1, p50: 2, p95: 4, p99: 4, max: 4 });
  });

  it("is null without samples", () => {
    expect(summarize([])).toBeNull();
  });
});

describe("p95WithUnreported", () => {
  it("counts unreported samples as below the threshold", () => {
    // 100 keystrokes; only the 3 slowest crossed the 16 ms reporting threshold.
    const result = p95WithUnreported({ reported: [40, 24, 32], total: 100, thresholdMs: 16 });
    expect(result).toEqual({ value: 16, atMost: true, samples: 100 });
  });

  it("reads the p95 from reported samples once they reach its rank", () => {
    const reported = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    const result = p95WithUnreported({ reported, total: 20, thresholdMs: 16 });
    expect(result).toEqual({ value: 25, atMost: false, samples: 20 });
  });

  it("ignores reported entries beyond the total it was told about", () => {
    const result = p95WithUnreported({ reported: [30, 40], total: 1, thresholdMs: 16 });
    expect(result).toEqual({ value: 40, atMost: false, samples: 2 });
  });

  it("has no value with nothing sampled", () => {
    expect(p95WithUnreported({ reported: [], total: 0, thresholdMs: 16 })).toBeNull();
  });
});

describe("p95AtMostFromBuckets", () => {
  it("returns the upper boundary of the bucket holding the 95th rank", () => {
    // Cumulative OTLP-style buckets: <=4, <=8, <=16, <=32, +Inf.
    const result = p95AtMostFromBuckets({ boundaries: [4, 8, 16, 32], counts: [10, 80, 8, 2, 0] });
    expect(result).toEqual({ value: 16, samples: 100, bucket: "8-16" });
  });

  it("has no bound when the rank lands in the overflow bucket", () => {
    const result = p95AtMostFromBuckets({ boundaries: [4, 8], counts: [1, 1, 18] });
    expect(result).toEqual({ value: null, samples: 20, bucket: ">8" });
  });

  it("has no value without samples", () => {
    expect(p95AtMostFromBuckets({ boundaries: [4, 8], counts: [0, 0, 0] })).toBeNull();
  });
});

describe("growthSlope", () => {
  it("fits a least-squares line through the samples", () => {
    const points = [
      { atMs: 0, value: 100 },
      { atMs: 60_000, value: 110 },
      { atMs: 120_000, value: 120 },
    ];
    expect(growthSlope(points)?.perMinute).toBeCloseTo(10, 6);
  });

  it("compares the first third with the last third", () => {
    const points = [0, 1, 2, 3, 4, 5].map((index) => ({
      atMs: index * 1000,
      value: index < 2 ? 10 : index < 4 ? 20 : 40,
    }));
    expect(growthSlope(points)?.lastThirdOverFirstThird).toBe(4);
  });

  it("needs at least two samples", () => {
    expect(growthSlope([{ atMs: 0, value: 1 }])).toBeNull();
  });
});
