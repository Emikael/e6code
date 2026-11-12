import { EFFORT_SEGMENT_LABELS, type EffortSegment } from "@e6tools/client-runtime/effort-segments";
import type {
  ProviderInteractionMode,
  ProviderOptionDescriptor,
  RuntimeMode,
} from "@e6tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@e6tools/shared/model";

import { runtimeModeConfig } from "./runtimeModeConfig";

export interface ComposerControlsSummaryPart {
  readonly text: string;
  /** Drawn in the warning role so a risky choice is never hidden in the chip. */
  readonly risky: boolean;
}

/**
 * What the compact composer chip says: effort, any trait set away from its
 * default (fast mode, context window, thinking, Ultrathink), permissions and
 * Plan or Build, in that order ("Balanced · Fast · Supervised · Build").
 * Effort is left out when the model has none; Plan or Build when plan mode is
 * off. Nothing that differs from the default is hidden behind the chip (F8).
 */
export function composerControlsSummary(input: {
  readonly effort: {
    readonly selected: EffortSegment | null;
    readonly currentLabel: string | null;
  } | null;
  readonly runtimeMode: RuntimeMode;
  /** Null when plan mode is not offered. */
  readonly interactionMode: ProviderInteractionMode | null;
  /** From `nonDefaultTraitLabels`. */
  readonly traits?: ReadonlyArray<string>;
}): ComposerControlsSummaryPart[] {
  const parts: ComposerControlsSummaryPart[] = [];
  const effort = input.effort?.selected
    ? EFFORT_SEGMENT_LABELS[input.effort.selected]
    : (input.effort?.currentLabel ?? null);
  if (effort) parts.push({ text: effort, risky: false });
  for (const trait of input.traits ?? []) {
    if (trait !== effort) parts.push({ text: trait, risky: false });
  }
  parts.push({
    text: runtimeModeConfig[input.runtimeMode].label,
    risky: input.runtimeMode === "full-access",
  });
  if (input.interactionMode !== null) {
    parts.push({ text: input.interactionMode === "plan" ? "Plan" : "Build", risky: false });
  }
  return parts;
}

/**
 * The model's traits that differ from their defaults, as the chip names them:
 * "Ultrathink", "Fast", "1M", "Thinking Off". The effort select (shown as the
 * effort part) and the agent (shown as Plan or Build) are left out.
 * `defaults` are the same descriptors resolved with no selections.
 */
export function nonDefaultTraitLabels(input: {
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly defaults: ReadonlyArray<ProviderOptionDescriptor>;
  readonly effortDescriptorId: string | null;
  /** The prompt asks for Ultrathink, which overrides the effort level. */
  readonly ultrathink: boolean;
}): string[] {
  const labels: string[] = input.ultrathink ? ["Ultrathink"] : [];
  for (const descriptor of input.descriptors) {
    if (descriptor.id === input.effortDescriptorId || descriptor.id === "agent") continue;
    // An unset switch is off.
    const valueOf = (candidate: ProviderOptionDescriptor | undefined) =>
      getProviderOptionCurrentValue(candidate) ??
      (candidate?.type === "boolean" ? false : undefined);
    const current = valueOf(descriptor);
    const fallback = input.defaults.find((candidate) => candidate.id === descriptor.id);
    if (current === undefined || current === valueOf(fallback)) continue;
    if (descriptor.type === "boolean") {
      labels.push(
        descriptor.id === "fastMode"
          ? current === true
            ? "Fast"
            : "Fast off"
          : `${descriptor.label} ${current === true ? "On" : "Off"}`,
      );
      continue;
    }
    const label = getProviderOptionCurrentLabel(descriptor);
    if (label) labels.push(label);
  }
  return labels;
}
