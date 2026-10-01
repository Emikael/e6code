import { describe, expect, it } from "@effect/vitest";

import { decideRoute, DEFAULT_THRESHOLDS, type PolicyThresholds } from "./confidencePolicy.ts";
import type { ClassifiedTurn } from "./JevEngine.ts";

const classified = (overrides: Partial<ClassifiedTurn> = {}): ClassifiedTurn => ({
  _tag: "Classified",
  route: "answer_deterministic",
  routeConfidence: 0.95,
  complexityScore: 0.2,
  selfContained: 0.95,
  sensitive: 0.05,
  latencyMs: 120,
  inputTokens: 100,
  model: "jev-1.13.0",
  ...overrides,
});

const thresholds: PolicyThresholds = DEFAULT_THRESHOLDS;

describe("decideRoute", () => {
  it("routes high-confidence self-contained turns to deterministic", () => {
    expect(decideRoute(classified(), thresholds)).toEqual({ _tag: "Deterministic" });
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

  it("falls back when the question is not self-contained", () => {
    expect(decideRoute(classified({ selfContained: 0.3 }), thresholds)).toEqual({
      _tag: "FullLlm",
      reason: "deterministic-below-threshold",
    });
  });

  it("routes simple questions to the fast path", () => {
    expect(
      decideRoute(classified({ route: "fast_llm_trimmed", routeConfidence: 0.7 }), thresholds),
    ).toEqual({
      _tag: "FastPath",
    });
  });

  it("names tool-bound and out-of-scope fallbacks", () => {
    expect(decideRoute(classified({ route: "needs_tools" }), thresholds)).toEqual({
      _tag: "FullLlm",
      reason: "needs-tools",
    });
    expect(decideRoute(classified({ route: "out_of_scope" }), thresholds)).toEqual({
      _tag: "FullLlm",
      reason: "out-of-scope",
    });
    expect(decideRoute(classified({ route: "full_llm" }), thresholds)).toEqual({
      _tag: "FullLlm",
      reason: "full-model-requested",
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
