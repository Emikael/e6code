import { describe, expect, it } from "@effect/vitest";

import {
  cacheSavingsUsd,
  createOverrideRateTable,
  lookupModelPriceTier,
  lookupRate,
  parseRateTable,
  priceUsage,
} from "./usagePricing.ts";

const rate = (input: number, cacheRead?: number) => ({
  input_cost_per_token: input,
  output_cost_per_token: input * 5,
  ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
});

describe("usage pricing", () => {
  const totals = {
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 500_000,
  };

  it("uses custom token rates ahead of public and provider-reported costs", () => {
    const table = parseRateTable({ "example-model": rate(1) });
    const overrides = createOverrideRateTable({
      "example-model": {
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 8,
        cacheReadCostPerMillionTokens: 0.5,
        cacheWriteCostPerMillionTokens: 3,
      },
    });

    for (const reportedCostUsd of [null, 99]) {
      expect(priceUsage(table, "example-model", totals, reportedCostUsd, overrides)).toEqual({
        costUsd: 13.5,
        costSource: "modelPriced",
      });
    }
    expect(cacheSavingsUsd(table, "example-model", totals, overrides)).toBe(1.5);
  });

  it("prices unknown models offline and uses input prices for omitted cache rates", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
    });

    expect(priceUsage(table, "example-model", totals, null, overrides)).toEqual({
      costUsd: 14,
      costSource: "modelPriced",
    });
    expect(cacheSavingsUsd(table, "example-model", totals, overrides)).toBe(0);
  });

  it("preserves explicit zero rates and matches only the exact trimmed model ID", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      " vendor/example-model[1m] ": {
        inputCostPerMillionTokens: 0,
        outputCostPerMillionTokens: 0,
      },
    });
    expect(priceUsage(table, " vendor/example-model[1m] ", totals, 99, overrides)).toEqual({
      costUsd: 0,
      costSource: "modelPriced",
    });
    for (const model of [
      "example-model[1m]",
      "vendor/example-model",
      "vendor/Example-model[1m]",
      "other/example-model[1m]",
    ]) {
      expect(priceUsage(table, model, totals, null, overrides).costSource).toBe("unpriced");
      expect(priceUsage(table, model, totals, 99, overrides)).toEqual({
        costUsd: 99,
        costSource: "providerReported",
      });
    }
  });

  it("keeps the canonical Fable rate separate from DeepInfra in either order", () => {
    const canonical = ["claude-fable-5", rate(1e-5, 1e-6)] as const;
    const deepInfra = ["deepinfra/anthropic/claude-fable-5", rate(1e-5)] as const;

    for (const entries of [
      [canonical, deepInfra],
      [deepInfra, canonical],
    ]) {
      const table = parseRateTable(Object.fromEntries(entries));

      expect(lookupRate(table, "claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
      expect(lookupRate(table, "deepinfra/anthropic/claude-fable-5")?.cacheReadCostPerToken).toBe(
        1e-5,
      );
      expect(lookupRate(table, "other/claude-fable-5")).toBeNull();
    }
  });

  it("prices a bracketed context-tier variant at the base model's rate", () => {
    const table = parseRateTable({ "claude-fable-5-1": rate(1e-5, 2.5e-7) });

    expect(lookupRate(table, "claude-fable-5-1[1m]")).toEqual(
      lookupRate(table, "claude-fable-5-1"),
    );
    expect(lookupRate(table, "anthropic/Claude-Fable-5-1[1m]")).toBeNull();
  });

  it("adds a bare alias when every qualified entry has the same rate", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(1),
    });

    expect(lookupRate(table, "example-model")).toEqual(
      lookupRate(table, "provider-a/example-model"),
    );
  });

  it("leaves an ambiguous bare name unpriced", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(3),
    });

    expect(lookupRate(table, "provider-a/example-model")?.inputCostPerToken).toBe(1);
    expect(lookupRate(table, "provider-b/example-model")?.inputCostPerToken).toBe(3);
    expect(lookupRate(table, "example-model")).toBeNull();
  });
});

describe("model price tiers", () => {
  // USD per million tokens; blended is (3 * input + output) / 4.
  const perMillion = (input: number, output: number) => ({
    input_cost_per_token: input / 1_000_000,
    output_cost_per_token: output / 1_000_000,
  });
  const table = parseRateTable({
    "nano-model": perMillion(0.1, 0.5), // blended 0.2
    "just-under-two": perMillion(1, 4.99), // blended 1.9975
    "haiku-class": perMillion(1, 5), // blended 2
    "sonnet-class": perMillion(2, 10), // blended 4
    "just-under-seven-fifty": perMillion(4, 17.99), // blended 7.4975
    "opus-class": perMillion(4, 18), // blended 7.5
    "frontier-class": perMillion(10, 50), // blended 20
    "anthropic/qualified-only": perMillion(2, 10),
  });

  it("buckets blended rates at $2 and $7.50 per million tokens", () => {
    expect(
      [
        "nano-model",
        "just-under-two",
        "haiku-class",
        "sonnet-class",
        "just-under-seven-fifty",
        "opus-class",
        "frontier-class",
      ].map((model) => lookupModelPriceTier(table, model)),
    ).toEqual([1, 1, 2, 2, 2, 3, 3]);
  });

  it("leaves models without a price, and unpriceable family names, without a tier", () => {
    expect(lookupModelPriceTier(table, "unknown-model")).toBeUndefined();
    expect(lookupModelPriceTier(table, "opus")).toBeUndefined();
    expect(lookupModelPriceTier(new Map(), "frontier-class")).toBeUndefined();
  });

  it("falls back to the bare name for provider-qualified slugs", () => {
    expect(lookupModelPriceTier(table, "opencode/frontier-class")).toBe(3);
    expect(lookupModelPriceTier(table, "anthropic/qualified-only")).toBe(2);
    expect(lookupModelPriceTier(table, "other/missing")).toBeUndefined();
  });

  it("falls back to the slug without an effort suffix", () => {
    const effortTable = parseRateTable({
      "gemini-flash": perMillion(0.75, 3.75), // blended 1.5
      "gemini-flash-high": perMillion(4, 20), // a real model of that name wins
      "vertex/gemini-pro": perMillion(2, 12),
      "other/gemini-pro": perMillion(4, 20),
    });

    expect(
      ["gemini-flash-low", "gemini-flash-medium", "gemini-flash-xhigh", "Gemini-Flash-HIGH"].map(
        (model) => lookupModelPriceTier(effortTable, model),
      ),
    ).toEqual([1, 1, 1, 3]);
    expect(lookupModelPriceTier(effortTable, "gemini-flash-high")).toBe(3);
    expect(lookupModelPriceTier(effortTable, "google/gemini-flash-low")).toBe(1);
    // Qualified entries disagree on the bare name's rate, so it stays unpriced.
    expect(lookupModelPriceTier(effortTable, "gemini-pro-high")).toBeUndefined();
    // Only effort words count as a suffix.
    expect(lookupModelPriceTier(effortTable, "gemini-flash-lite")).toBeUndefined();
  });

  it("prices every slug that shows a tier, through the same fallbacks", () => {
    const usage = {
      uncachedInputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    const fallbackTable = parseRateTable({
      "frontier-class": perMillion(10, 50),
      "gemini-flash": perMillion(0.75, 3.75),
    });
    for (const model of [
      "opencode/frontier-class",
      "gemini-flash-high",
      "google/gemini-flash-low",
    ]) {
      expect(lookupModelPriceTier(fallbackTable, model)).toBeDefined();
      expect(priceUsage(fallbackTable, model, usage, null).costSource).toBe("modelPriced");
    }
    expect(priceUsage(fallbackTable, "opencode/frontier-class", usage, null).costUsd).toBe(10);
    expect(priceUsage(fallbackTable, "other/missing", usage, null).costSource).toBe("unpriced");
  });

  it("prefers custom prices over the public table", () => {
    const overrides = createOverrideRateTable({
      "frontier-class": { inputCostPerMillionTokens: 0.1, outputCostPerMillionTokens: 0.4 },
      "custom-model": { inputCostPerMillionTokens: 3, outputCostPerMillionTokens: 15 },
    });

    expect(lookupModelPriceTier(table, "frontier-class", overrides)).toBe(1);
    expect(lookupModelPriceTier(table, "custom-model", overrides)).toBe(2);
  });
});
