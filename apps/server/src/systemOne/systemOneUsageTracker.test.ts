import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  JEV_INPUT_COST_USD_PER_MTOK,
  layer,
  layerTest,
  summarizeSystemOneUsage,
  SystemOneUsageTracker,
} from "./systemOneUsageTracker.ts";

describe("SystemOneUsageTracker", () => {
  it.live("counts outcomes and averages latency", () =>
    Effect.gen(function* () {
      const tracker = yield* SystemOneUsageTracker;
      yield* tracker.record({ outcome: "deterministic", latencyMs: 100, jevInputTokens: 50 });
      yield* tracker.record({ outcome: "deterministic", latencyMs: 200, jevInputTokens: 70 });
      yield* tracker.record({ outcome: "fast-path", latencyMs: 150 });
      yield* tracker.record({ outcome: "full-llm" });
      const totals = yield* tracker.readTotals;
      expect(totals.calls).toBe(4);
      expect(totals.deterministic).toBe(2);
      expect(totals.fastPath).toBe(1);
      expect(totals.fallback).toBe(1);
      expect(totals.llmCallsAvoided).toBe(2);
      expect(totals.jevInputTokens).toBe(120);
      expect(totals.avgLatencyMs).toBe(150);
    }).pipe(Effect.provide(layer)),
  );

  it.live("stays zero in the test layer", () =>
    Effect.gen(function* () {
      const tracker = yield* SystemOneUsageTracker;
      yield* tracker.record({ outcome: "deterministic" });
      expect(yield* tracker.readTotals).toMatchObject({ calls: 0, llmCallsAvoided: 0 });
    }).pipe(Effect.provide(layerTest)),
  );
});
describe("summarizeSystemOneUsage", () => {
  it("costs metered Jev tokens at the pinned input price", () => {
    expect(
      summarizeSystemOneUsage({
        calls: 10,
        deterministic: 4,
        fastPath: 2,
        fallback: 4,
        llmCallsAvoided: 4,
        jevInputTokens: 1_000_000,
        latencySumMs: 1000,
        latencyCount: 8,
        avgLatencyMs: 125,
      }),
    ).toEqual({
      calls: 10,
      deterministic: 4,
      fastPath: 2,
      fallback: 4,
      llmCallsAvoided: 4,
      jevInputTokens: 1_000_000,
      jevCostUsd: JEV_INPUT_COST_USD_PER_MTOK,
      avgLatencyMs: 125,
    });
  });

  it("reports zero spend without any metered tokens", () => {
    const summary = summarizeSystemOneUsage({
      calls: 3,
      deterministic: 1,
      fastPath: 0,
      fallback: 2,
      llmCallsAvoided: 1,
      jevInputTokens: 0,
      latencySumMs: 90,
      latencyCount: 1,
      avgLatencyMs: 90,
    });
    expect(summary.jevInputTokens).toBe(0);
    expect(summary.jevCostUsd).toBe(0);
    expect(summary.llmCallsAvoided).toBe(1);
  });
});
