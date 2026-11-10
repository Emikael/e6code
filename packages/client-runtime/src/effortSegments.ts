import type { ProviderOptionDescriptor } from "@e6tools/contracts";
import { REASONING_SELECT_DESCRIPTOR_IDS } from "@e6tools/shared/model";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

/** The three quick effort steps. Each model's own level list stays in the traits menu. */
export const EFFORT_SEGMENTS = ["fast", "balanced", "deep"] as const;
export type EffortSegment = (typeof EFFORT_SEGMENTS)[number];

export const EFFORT_SEGMENT_LABELS: Readonly<Record<EffortSegment, string>> = {
  fast: "Fast",
  balanced: "Balanced",
  deep: "Deep",
};

// Workflow and ceiling levels stay out of the quick steps: Max and Ultracode cost far more than a
// step up, and prompt-injected levels such as Ultrathink edit the prompt instead.
const EXCLUDED_LEVELS: ReadonlySet<string> = new Set(["max", "ultracode", "none", "off"]);

export interface EffortSegments {
  /** Option ids keyed by segment. */
  readonly values: Readonly<Record<EffortSegment, string>>;
  /** The model's own label for each segment's level, such as "Extra High". */
  readonly levelLabels: Readonly<Record<EffortSegment, string>>;
  /** The ordinary levels the segments were picked from, lowest first. */
  readonly levels: ReadonlyArray<string>;
}

/**
 * Picks Fast, Balanced and Deep from a model's reasoning select: the lowest and highest ordinary
 * levels, and the model default (or Medium) between them. Returns null when the descriptor is not
 * a reasoning effort or has fewer than three ordinary levels, so the quick control hides.
 */
export function resolveEffortSegments(
  descriptor: SelectDescriptor | null | undefined,
): EffortSegments | null {
  if (!descriptor || !REASONING_SELECT_DESCRIPTOR_IDS.has(descriptor.id)) return null;
  const injected = new Set(descriptor.promptInjectedValues ?? []);
  const levels = descriptor.options.filter(
    (option) => !injected.has(option.id) && !EXCLUDED_LEVELS.has(option.id),
  );
  if (levels.length < 3) return null;
  const inner = levels.slice(1, -1);
  const balanced =
    inner.find((option) => option.isDefault) ??
    inner.find((option) => option.id === "medium") ??
    inner[Math.floor((inner.length - 1) / 2)]!;
  const fast = levels[0]!;
  const deep = levels.at(-1)!;
  return {
    values: { fast: fast.id, balanced: balanced.id, deep: deep.id },
    levelLabels: { fast: fast.label, balanced: balanced.label, deep: deep.label },
    levels: levels.map((option) => option.id),
  };
}

/**
 * Tooltip and accessible name for a step. It says "Effort" and the real level, so Fast never
 * reads as fast mode: "Effort: Balanced · High".
 */
export function effortSegmentName(segments: EffortSegments, segment: EffortSegment): string {
  return `Effort: ${EFFORT_SEGMENT_LABELS[segment]} · ${segments.levelLabels[segment]}`;
}

/** The segment whose level is selected, or null when the model sits on another level. */
export function effortSegmentForValue(
  segments: EffortSegments,
  value: string | null | undefined,
): EffortSegment | null {
  return EFFORT_SEGMENTS.find((segment) => segments.values[segment] === value) ?? null;
}

/**
 * The next segment for the cycle shortcut. From a level between segments it moves to the next
 * segment above; from Deep or a level outside the quick steps it wraps to Fast.
 */
export function nextEffortSegment(
  segments: EffortSegments,
  value: string | null | undefined,
): EffortSegment {
  const rank = value ? segments.levels.indexOf(value) : -1;
  if (rank < 0) return "fast";
  return (
    EFFORT_SEGMENTS.find((segment) => segments.levels.indexOf(segments.values[segment]) > rank) ??
    "fast"
  );
}
