import { describe, expect, it } from "@effect/vitest";

import { decideRoute, DEFAULT_THRESHOLDS, type PolicyThresholds } from "./confidencePolicy.ts";
import type { ClassifiedTurn } from "./JevEngine.ts";

const classified = (overrides: Partial<ClassifiedTurn> = {}): ClassifiedTurn => ({
  _tag: "Classified",
  route: "local_lookup",
  routeConfidence: 0.95,
  localFact: "greeting",
  dependsOnEarlierTurns: 0.05,
  sensitive: 0.05,
  latencyMs: 120,
  inputTokens: 100,
  model: "jev-1.13.0",
  ...overrides,
});

const thresholds: PolicyThresholds = DEFAULT_THRESHOLDS;

describe("decideRoute", () => {
  it("routes high-confidence local lookups to deterministic", () => {
    expect(decideRoute(classified(), thresholds)).toEqual({ _tag: "Deterministic" });
  });

  it("keeps a confident local lookup even when earlier turns exist", () => {
    expect(decideRoute(classified({ dependsOnEarlierTurns: 0.99 }), thresholds)).toEqual({
      _tag: "Deterministic",
    });
  });

  it("falls back below the confidence floor", () => {
    expect(decideRoute(classified({ routeConfidence: 0.4 }), thresholds)).toEqual({
      _tag: "FullLlm",
      reason: "low-confidence",
    });
  });

  it("falls back on sensitive content even at high confidence", () => {
    expect(decideRoute(classified({ sensitive: 0.9 }), thresholds)).toEqual({
      _tag: "FullLlm",
      reason: "sensitive-or-risky",
    });
  });

  it("falls back when deterministic confidence is under its threshold", () => {
    expect(decideRoute(classified({ routeConfidence: 0.7 }), thresholds)).toEqual({
      _tag: "FullLlm",
      reason: "deterministic-below-threshold",
    });
  });

  it("routes simple questions to the fast path", () => {
    expect(
      decideRoute(
        classified({ route: "trimmed_provider", routeConfidence: 0.7, localFact: "none" }),
        thresholds,
      ),
    ).toEqual({
      _tag: "FastPath",
    });
  });

  it("does not trim when the turn depends on earlier context", () => {
    expect(
      decideRoute(
        classified({
          route: "trimmed_provider",
          routeConfidence: 0.9,
          dependsOnEarlierTurns: 0.8,
          localFact: "none",
        }),
        thresholds,
      ),
    ).toEqual({
      _tag: "FullLlm",
      reason: "depends-on-earlier-turns",
    });
  });

  it("sends the full provider when that is the handler", () => {
    expect(
      decideRoute(classified({ route: "full_provider", localFact: "none" }), thresholds),
    ).toEqual({
      _tag: "FullLlm",
      reason: "full-provider",
    });
  });

  it("honors custom thresholds", () => {
    const strict = { ...thresholds, deterministicThreshold: 0.99 };
    expect(decideRoute(classified(), strict)).toEqual({
      _tag: "FullLlm",
      reason: "deterministic-below-threshold",
    });
  });
});
