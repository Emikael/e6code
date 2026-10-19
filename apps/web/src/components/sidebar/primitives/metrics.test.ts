import { describe, expect, it } from "vite-plus/test";
import { normalizeCount, resolvePlanProgress, resolveUsage } from "./metrics";

describe("Switchboard metrics", () => {
  it("keeps unavailable counts distinct from zero and normalizes counts", () => {
    expect(normalizeCount(undefined)).toBeNull();
    expect(normalizeCount(Number.NaN)).toBeNull();
    expect(normalizeCount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeCount(0)).toBe(0);
    expect(normalizeCount(-4)).toBe(0);
    expect(normalizeCount(3.9)).toBe(3);
  });
  it("uses the usage source and threshold boundaries", () => {
    expect(resolveUsage(null)).toEqual({ percent: null, severity: "unknown" });
    expect(resolveUsage(Number.NaN).severity).toBe("unknown");
    expect(resolveUsage(79.9).severity).toBe("normal");
    expect(resolveUsage(80).severity).toBe("warning");
    expect(resolveUsage(94.9).severity).toBe("warning");
    expect(resolveUsage(95).severity).toBe("error");
    expect(resolveUsage(120).percent).toBe(100);
    expect(resolveUsage(-2).percent).toBe(0);
  });
  it("clamps progress and never exposes nonfinite or negative ranges", () => {
    expect(resolvePlanProgress(3, 7)).toEqual({ completed: 3, total: 7, percent: 300 / 7 });
    expect(resolvePlanProgress(9, 3)).toEqual({ completed: 3, total: 3, percent: 100 });
    expect(resolvePlanProgress(-1, 3).completed).toBe(0);
    expect(resolvePlanProgress(2, 0)).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(resolvePlanProgress(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
    });
  });
});
