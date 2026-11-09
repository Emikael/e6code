import {
  effortSegmentForValue,
  resolveEffortSegments,
} from "@e6tools/client-runtime/effort-segments";
import type { ProviderOptionDescriptor, RuntimeMode } from "@e6tools/contracts";
import { getProviderOptionCurrentValue } from "@e6tools/shared/model";

/**
 * Desktop-oriented effort keywords that don't belong in the phone picker.
 * Prompt-injected values (ultrathink and friends) are filtered from the
 * descriptor metadata; ultracode is a real option but a workflow trigger, not
 * a reasoning level. A value set elsewhere still displays, it just isn't
 * offered.
 */
const HIDDEN_EFFORT_OPTION_IDS: ReadonlySet<string> = new Set(["ultracode"]);

export const RUNTIME_MODE_CHOICES: ReadonlyArray<{
  readonly mode: RuntimeMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    mode: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    mode: "auto",
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  {
    mode: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
];

export function selectableChoices(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
) {
  const injected = new Set(descriptor.promptInjectedValues ?? []);
  return descriptor.options.filter(
    (option) => !injected.has(option.id) && !HIDDEN_EFFORT_OPTION_IDS.has(option.id),
  );
}

/**
 * Fast / Balanced / Deep for the sheet's effort row. Like the web composer, effort is the first
 * select option; null when it is not effort or the model has too few levels for three steps.
 */
export function resolveEffortSteps(descriptors: ReadonlyArray<ProviderOptionDescriptor>) {
  const descriptor = descriptors.find(
    (candidate): candidate is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      candidate.type === "select",
  );
  const segments = resolveEffortSegments(descriptor);
  if (!descriptor || !segments) return null;
  const current = getProviderOptionCurrentValue(descriptor);
  return {
    descriptorId: descriptor.id,
    segments,
    selected: effortSegmentForValue(segments, typeof current === "string" ? current : null),
  };
}
