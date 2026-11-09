import { describe, expect, it } from "vite-plus/test";

import { cachedInputPercent, sharePercents, tokenSplit } from "./usageShares.ts";

describe("sharePercents", () => {
  it("rounds by largest remainder so the shares add up to 100", () => {
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharePercents([21.4, 19.85, 6.95])).toEqual([44, 41, 15]);
    const shares = sharePercents([0.333, 0.333, 0.334, 5, 7]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
  });

  it("keeps a provider with nothing at zero", () => {
    expect(sharePercents([10, 0])).toEqual([100, 0]);
  });

  it("gives all zeros when there is nothing to share", () => {
    expect(sharePercents([0, 0])).toEqual([0, 0]);
    expect(sharePercents([])).toEqual([]);
  });
});

describe("tokenSplit", () => {
  it("splits input three ways plus output without counting reasoning twice", () => {
    const split = tokenSplit({
      uncachedInputTokens: 100,
      cachedInputTokens: 600,
      cacheCreationTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
    });
    expect(split.totalTokens).toBe(1_000);
    expect(split.parts.map((part) => [part.key, part.tokens, part.percent])).toEqual([
      ["uncached", 100, 10],
      ["cacheRead", 600, 60],
      ["cacheWrite", 100, 10],
      ["output", 200, 20],
    ]);
    expect(split.reasoning).toEqual({ tokens: 50, percentOfOutput: 25 });
  });

  it("never reports more reasoning than output", () => {
    const split = tokenSplit({
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 10,
      reasoningTokens: 40,
    });
    expect(split.reasoning).toEqual({ tokens: 10, percentOfOutput: 100 });
  });

  it("reports zero reasoning share when there is no output", () => {
    const split = tokenSplit({
      uncachedInputTokens: 5,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    });
    expect(split.reasoning.percentOfOutput).toBe(0);
    expect(split.parts[0]?.percent).toBe(100);
  });
});

describe("cachedInputPercent", () => {
  const totals = {
    uncachedInputTokens: 200,
    cachedInputTokens: 700,
    cacheCreationTokens: 100,
    outputTokens: 5_000,
    reasoningTokens: 1_000,
  };

  it("divides cache reads by all input, counting cache writes as uncached", () => {
    expect(cachedInputPercent(totals)).toBe(70);
  });

  it("ignores output entirely", () => {
    expect(cachedInputPercent({ ...totals, outputTokens: 0, reasoningTokens: 0 })).toBe(70);
  });

  it("has no ratio without input", () => {
    expect(
      cachedInputPercent({
        ...totals,
        uncachedInputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
      }),
    ).toBeNull();
  });
});
