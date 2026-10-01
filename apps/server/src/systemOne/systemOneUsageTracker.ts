/**
 * systemOneUsageTracker - in-memory pre-router counters, day-bucketed.
 *
 * Records every turn where Jev classified a result (deterministic answers,
 * fast-path routes, and classified fallbacks alike). Skipped calls never
 * reached Jev and are not counted. Totals live for the process lifetime and
 * reset on restart; the usage summary labels them as since-boot. Token counts
 * are metered Jev input tokens; cost scales them by the pinned Jev input
 * price.
 *
 * @module systemOneUsageTracker
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

/** Pinned Jev input price, USD per million tokens. */
export const JEV_INPUT_COST_USD_PER_MTOK = 0.042;

export type SystemOneRecordOutcome = "deterministic" | "fast-path" | "full-llm";

export interface SystemOneRecordInput {
  readonly outcome: SystemOneRecordOutcome;
  readonly latencyMs?: number;
  readonly jevInputTokens?: number;
}

interface DayCounters {
  calls: number;
  deterministic: number;
  fastPath: number;
  fallback: number;
  llmCallsAvoided: number;
  jevInputTokens: number;
  latencySumMs: number;
  latencyCount: number;
}

export interface SystemOneTotals extends DayCounters {
  avgLatencyMs: number;
}

const emptyCounters = (): DayCounters => ({
  calls: 0,
  deterministic: 0,
  fastPath: 0,
  fallback: 0,
  llmCallsAvoided: 0,
  jevInputTokens: 0,
  latencySumMs: 0,
  latencyCount: 0,
});

export class SystemOneUsageTracker extends Context.Service<
  SystemOneUsageTracker,
  {
    readonly record: (input: SystemOneRecordInput) => Effect.Effect<void>;
    readonly readTotals: Effect.Effect<SystemOneTotals>;
  }
>()("e6/systemOne/systemOneUsageTracker") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("SystemOneUsageTracker.make")(function* () {
  const daysRef = yield* Ref.make(new Map<string, DayCounters>());

  const record = Effect.fn("SystemOneUsageTracker.record")(function* (input: SystemOneRecordInput) {
    const now = yield* Clock.currentTimeMillis;
    const day = DateTime.formatIso(DateTime.makeUnsafe(now)).slice(0, 10);
    yield* Ref.update(daysRef, (days) => {
      const next = new Map(days);
      const counters = next.get(day) ?? emptyCounters();
      const updated: DayCounters = {
        calls: counters.calls + 1,
        deterministic: counters.deterministic + (input.outcome === "deterministic" ? 1 : 0),
        fastPath: counters.fastPath + (input.outcome === "fast-path" ? 1 : 0),
        fallback: counters.fallback + (input.outcome === "full-llm" ? 1 : 0),
        llmCallsAvoided: counters.llmCallsAvoided + (input.outcome === "deterministic" ? 1 : 0),
        jevInputTokens: counters.jevInputTokens + (input.jevInputTokens ?? 0),
        latencySumMs: counters.latencySumMs + (input.latencyMs ?? 0),
        latencyCount: counters.latencyCount + (input.latencyMs !== undefined ? 1 : 0),
      };
      next.set(day, updated);
      return next;
    });
  });

  const readTotals = Effect.fn("SystemOneUsageTracker.readTotals")(function* () {
    const days = yield* Ref.get(daysRef);
    const totals = emptyCounters();
    for (const counters of days.values()) {
      totals.calls += counters.calls;
      totals.deterministic += counters.deterministic;
      totals.fastPath += counters.fastPath;
      totals.fallback += counters.fallback;
      totals.llmCallsAvoided += counters.llmCallsAvoided;
      totals.jevInputTokens += counters.jevInputTokens;
      totals.latencySumMs += counters.latencySumMs;
      totals.latencyCount += counters.latencyCount;
    }
    return {
      ...totals,
      avgLatencyMs: totals.latencyCount > 0 ? totals.latencySumMs / totals.latencyCount : 0,
    };
  });

  return SystemOneUsageTracker.of({ record: (input) => record(input), readTotals: readTotals() });
});

export const layer: Layer.Layer<SystemOneUsageTracker> = Layer.effect(
  SystemOneUsageTracker,
  make(),
);

/**
 * Merge raw totals into the contract section. Cost scales metered Jev input
 * tokens by the pinned input price: a metered figure, not an estimate.
 */
export const summarizeSystemOneUsage = (
  totals: SystemOneTotals,
): {
  calls: number;
  deterministic: number;
  fastPath: number;
  fallback: number;
  llmCallsAvoided: number;
  jevInputTokens: number;
  jevCostUsd: number;
  avgLatencyMs: number;
} => ({
  calls: totals.calls,
  deterministic: totals.deterministic,
  fastPath: totals.fastPath,
  fallback: totals.fallback,
  llmCallsAvoided: totals.llmCallsAvoided,
  jevInputTokens: totals.jevInputTokens,
  jevCostUsd: (totals.jevInputTokens * JEV_INPUT_COST_USD_PER_MTOK) / 1_000_000,
  avgLatencyMs: totals.avgLatencyMs,
});

/** Test layer: recordings vanish, totals stay zero. */
export const layerTest: Layer.Layer<SystemOneUsageTracker> = Layer.succeed(
  SystemOneUsageTracker,
  SystemOneUsageTracker.of({
    record: () => Effect.void,
    readTotals: Effect.succeed({
      ...emptyCounters(),
      avgLatencyMs: 0,
    }),
  }),
);
