import type { ModelSelection, ServerConfig } from "@e6tools/contracts";
import {
  buildHandoffTargets,
  maxUsedPercent,
  type HandoffTargetOption,
} from "@e6tools/client-runtime/state/thread-handoff";
import {
  getProviderOptionCurrentLabel,
  REASONING_SELECT_DESCRIPTOR_IDS,
} from "@e6tools/shared/model";

import {
  buildModelOptions,
  normalizeSelectionOptions,
  type ModelOption,
} from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";

export interface MobileHandoffCatalog {
  /** Every usable provider except the source; limited ones are flagged, available first. */
  readonly targets: ReadonlyArray<HandoffTargetOption>;
  /** Selectable models on available targets, in the same shape the settings sheet lists. */
  readonly options: ReadonlyArray<ModelOption>;
}

/**
 * Targets are the providers the mobile picker can already use (enabled,
 * installed, signed in), minus the source thread's provider.
 */
export function buildMobileHandoffCatalog(
  config: ServerConfig | null | undefined,
  sourceInstanceId: string,
): MobileHandoffCatalog {
  const usable = buildModelOptions(config, null).filter(
    (option) => !option.isUnavailable && option.providerKey !== sourceInstanceId,
  );
  const providers = new Map<string, ModelOption>();
  for (const option of usable) {
    const current = providers.get(option.providerKey);
    if (!current || rankDefault(option) < rankDefault(current)) {
      providers.set(option.providerKey, option);
    }
  }
  const targets = buildHandoffTargets(
    [...providers.values()].map((option) => ({
      instanceId: option.providerKey,
      model: option.selection.model,
      label: option.providerLabel,
      usedPercent: maxUsedPercent(
        config?.providers.find((provider) => provider.instanceId === option.providerKey)
          ?.usageLimits,
      ),
    })),
    sourceInstanceId,
  );
  const available = new Set(
    targets.filter((target) => target.available).map((target) => target.instanceId),
  );
  return { targets, options: usable.filter((option) => available.has(option.providerKey)) };
}

// Prefer the provider's default model, then any current one, then legacy.
function rankDefault(option: ModelOption): number {
  if (option.isDefault && !option.isLegacy) return 0;
  return option.isLegacy ? 2 : 1;
}

function findOption(
  options: ReadonlyArray<ModelOption>,
  selection: { readonly instanceId: string; readonly model: string },
): ModelOption | undefined {
  return options.find(
    (option) =>
      option.selection.instanceId === selection.instanceId &&
      option.selection.model === selection.model,
  );
}

/**
 * The last model the user picked when it is still offered, otherwise the
 * first available provider's default model. Null when nothing is available.
 */
export function resolveHandoffDefaultSelection(
  catalog: MobileHandoffCatalog,
  sticky: ModelSelection | null,
): ModelSelection | null {
  const stickyOption = sticky ? findOption(catalog.options, sticky) : undefined;
  if (sticky && stickyOption) return normalizeSelectionOptions(sticky, stickyOption.capabilities);
  const first = catalog.targets.find((target) => target.available);
  return first ? (findOption(catalog.options, first)?.selection ?? null) : null;
}

/** Re-checked on Continue: the pick must still be an offered model on an available provider. */
export function isHandoffSelectionStartable(
  catalog: MobileHandoffCatalog,
  selection: ModelSelection | null,
): selection is ModelSelection {
  return selection !== null && findOption(catalog.options, selection) !== undefined;
}

/** `Claude Fable 5.1 · High`, or just the model when it has no effort option. */
export function handoffSelectionLabel(
  catalog: MobileHandoffCatalog,
  selection: ModelSelection,
): string {
  const option = findOption(catalog.options, selection);
  const model = option?.label ?? selection.model;
  const effort = resolveProviderOptionDescriptors({
    capabilities: option?.capabilities,
    selections: selection.options,
  }).find(
    (descriptor) =>
      descriptor.type === "select" && REASONING_SELECT_DESCRIPTOR_IDS.has(descriptor.id),
  );
  const effortLabel = getProviderOptionCurrentLabel(effort);
  return effortLabel ? `${model} · ${effortLabel}` : model;
}

/** `Grok is also at its usage limit.` for the limited providers left out of the picker. */
export function limitedHandoffNote(targets: ReadonlyArray<HandoffTargetOption>): string | null {
  const labels = targets.filter((target) => !target.available).map((target) => target.label);
  if (labels.length === 0) return null;
  if (labels.length === 1) return `${labels[0]} is also at its usage limit.`;
  const names = `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `${names} are also at their usage limits.`;
}
