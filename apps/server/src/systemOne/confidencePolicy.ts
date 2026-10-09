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
 * Local replies need a confident `local_lookup`. Trimming needs a confident
 * `trimmed_provider` and an earlier-turn probability below the self-contained
 * threshold. A risk probability at or above the risk threshold, including one
 * near 0.5, stays on the full provider.
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
    case "local_lookup": {
      if (classified.routeConfidence >= thresholds.deterministicThreshold) {
        return { _tag: "Deterministic" };
      }
      return { _tag: "FullLlm", reason: "deterministic-below-threshold" };
    }
    case "trimmed_provider": {
      if (classified.routeConfidence < thresholds.fastPathThreshold) {
        return { _tag: "FullLlm", reason: "fast-path-below-threshold" };
      }
      if (classified.dependsOnEarlierTurns >= thresholds.selfContainedThreshold) {
        return { _tag: "FullLlm", reason: "depends-on-earlier-turns" };
      }
      return { _tag: "FastPath" };
    }
    default: {
      return { _tag: "FullLlm", reason: "full-provider" };
    }
  }
};
