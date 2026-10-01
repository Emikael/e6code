/**
 * confidencePolicy - turns a Jev classification into a routing decision.
 *
 * Pure: thresholds in, decision out. The reactor acts on it. Every
 * low-confidence or high-risk outcome falls back to the full LLM — the
 * policy never invents a third option.
 *
 * @module confidencePolicy
 */
import type { ClassifiedTurn } from "./JevEngine.ts";

export interface PolicyThresholds {
  readonly deterministicThreshold: number;
  readonly fastPathThreshold: number;
  readonly confidenceFloor: number;
  readonly selfContainedThreshold: number;
  readonly riskThreshold: number;
}

export const DEFAULT_THRESHOLDS: PolicyThresholds = {
  deterministicThreshold: 0.85,
  fastPathThreshold: 0.6,
  confidenceFloor: 0.5,
  selfContainedThreshold: 0.8,
  riskThreshold: 0.5,
};

export type RouteDecision =
  | { readonly _tag: "Deterministic" }
  | { readonly _tag: "FastPath" }
  | { readonly _tag: "FullLlm"; readonly reason: string };

/**
 * Deterministic answers need near-certainty on every axis: the right route,
 * a self-contained question, and no sensitive or destructive content.
 * Anything else degrades to fast-path or the full model.
 */
export const decideRoute = (
  classified: ClassifiedTurn,
  thresholds: PolicyThresholds = DEFAULT_THRESHOLDS,
): RouteDecision => {
  if (classified.routeConfidence < thresholds.confidenceFloor) {
    return { _tag: "FullLlm", reason: "low-confidence" };
  }
  if (classified.sensitive >= thresholds.riskThreshold) {
    return { _tag: "FullLlm", reason: "sensitive-or-risky" };
  }
  switch (classified.route) {
    case "answer_deterministic": {
      if (
        classified.routeConfidence >= thresholds.deterministicThreshold &&
        classified.selfContained >= thresholds.selfContainedThreshold
      ) {
        return { _tag: "Deterministic" };
      }
      return { _tag: "FullLlm", reason: "deterministic-below-threshold" };
    }
    case "fast_llm_trimmed": {
      if (classified.routeConfidence >= thresholds.fastPathThreshold) {
        return { _tag: "FastPath" };
      }
      return { _tag: "FullLlm", reason: "fast-path-below-threshold" };
    }
    default: {
      return {
        _tag: "FullLlm",
        reason:
          classified.route === "needs_tools"
            ? "needs-tools"
            : classified.route === "out_of_scope"
              ? "out-of-scope"
              : "full-model-requested",
      };
    }
  }
};
