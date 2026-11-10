import { type ModelPriceTier, ProviderDriverKind } from "@e6tools/contracts";
import { EFFORT_SEGMENT_LABELS, type EffortSegment } from "@e6tools/client-runtime/effort-segments";
import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  Icon,
  OpenAI,
  OpenCodeIcon,
} from "../Icons";

export const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI,
  [ProviderDriverKind.make("opencode")]: OpenCodeIcon,
  [ProviderDriverKind.make("cursor")]: CursorIcon,
  [ProviderDriverKind.make("grok")]: GrokIcon,
  [ProviderDriverKind.make("antigravity")]: AntigravityIcon,
};

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  aliases?: ReadonlyArray<string> | undefined;
  isDefault?: boolean | undefined;
  badge?: "new" | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
  contextWindowTokens?: number | undefined;
  priceTier?: ModelPriceTier | undefined;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingQualifier(value: string, qualifier: string | null | undefined): string {
  const trimmedQualifier = qualifier?.trim();
  if (!trimmedQualifier) {
    return value;
  }

  const pattern = new RegExp(`^${escapeRegExp(trimmedQualifier)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu");
  return value.replace(pattern, "").trim() || value;
}

export function getDisplayModelName(
  model: ModelEsque,
  options?: { preferShortName?: boolean },
): string {
  const name = options?.preferShortName && model.shortName ? model.shortName : model.name;
  return stripLeadingQualifier(name, model.subProvider);
}

export function getTriggerDisplayModelName(model: ModelEsque): string {
  return getDisplayModelName(model, { preferShortName: true });
}

export function getTriggerDisplayModelLabel(model: ModelEsque): string {
  return getTriggerDisplayModelName(model);
}

/**
 * The composer's model chip: "Claude Opus · balanced". The effort step names itself beside the
 * model so the chip says what runs even where the segmented control is hidden; a level between or
 * beyond the three steps shows its own name.
 */
export function formatModelChipLabel(
  modelLabel: string,
  effort:
    | { readonly selected: EffortSegment | null; readonly currentLabel: string | null }
    | null
    | undefined,
): string {
  const effortLabel = effort?.selected
    ? EFFORT_SEGMENT_LABELS[effort.selected]
    : (effort?.currentLabel ?? null);
  return effortLabel ? `${modelLabel} · ${effortLabel.toLowerCase()}` : modelLabel;
}
