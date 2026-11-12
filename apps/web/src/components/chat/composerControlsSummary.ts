import { EFFORT_SEGMENT_LABELS, type EffortSegment } from "@e6tools/client-runtime/effort-segments";
import type { ProviderInteractionMode, RuntimeMode } from "@e6tools/contracts";

import { runtimeModeConfig } from "./runtimeModeConfig";

export interface ComposerControlsSummaryPart {
  readonly text: string;
  /** Drawn in the warning role so a risky choice is never hidden in the chip. */
  readonly risky: boolean;
}

/**
 * What the compact composer chip says: effort, permissions and Plan or Build,
 * in that order ("Balanced · Supervised · Build"). Effort is left out when the
 * model has none; Plan or Build when plan mode is off.
 */
export function composerControlsSummary(input: {
  readonly effort: {
    readonly selected: EffortSegment | null;
    readonly currentLabel: string | null;
  } | null;
  readonly runtimeMode: RuntimeMode;
  /** Null when plan mode is not offered. */
  readonly interactionMode: ProviderInteractionMode | null;
}): ComposerControlsSummaryPart[] {
  const parts: ComposerControlsSummaryPart[] = [];
  const effort = input.effort?.selected
    ? EFFORT_SEGMENT_LABELS[input.effort.selected]
    : (input.effort?.currentLabel ?? null);
  if (effort) parts.push({ text: effort, risky: false });
  parts.push({
    text: runtimeModeConfig[input.runtimeMode].label,
    risky: input.runtimeMode === "full-access",
  });
  if (input.interactionMode !== null) {
    parts.push({ text: input.interactionMode === "plan" ? "Plan" : "Build", risky: false });
  }
  return parts;
}
