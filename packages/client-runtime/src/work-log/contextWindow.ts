import type { OrchestrationThreadActivity, ThreadTokenUsageSnapshot } from "@e6tools/contracts";
import { formatTokens } from "@e6tools/shared/usageFormat";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    const maxTokens = asFiniteNumber(payload?.maxTokens);
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: asFiniteNumber(payload?.inputTokens),
      cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
      outputTokens: asFiniteNumber(payload?.outputTokens),
      reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
      lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(payload?.toolUses),
      durationMs: asFiniteNumber(payload?.durationMs),
      compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
      autoCompactThreshold: asFiniteNumber(payload?.autoCompactThreshold),
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  return formatTokens(value);
}

/** Usage at or above this share of the window reads as a warning. */
const CONTEXT_WINDOW_WARNING_PERCENT = 85;

export interface ContextWindowUsageSummary {
  /** "68% used · 136K of 200K tokens", or "136K tokens used" without a known window. */
  readonly label: string;
  /** Share of the window in use, 0-100, rounded; null without a known window. */
  readonly percent: number | null;
  /** True at or above CONTEXT_WINDOW_WARNING_PERCENT. The label carries the number. */
  readonly warning: boolean;
  /** "Compacts automatically near 90%", when the provider reports a threshold. */
  readonly compactionNote: string | null;
  /** The label and note as one sentence for assistive technology. */
  readonly accessibilityLabel: string;
}

function formatUsedPercent(percentage: number): string {
  if (percentage > 0 && percentage < 1) return "<1%";
  return `${Math.round(percentage)}%`;
}

/**
 * Text for the Overview inspector's Context section, shared by web and mobile.
 * The compaction note says what the composer meter says ("Compacts
 * automatically at 200,000 tokens."), as a share of the window when the
 * window is known.
 */
export function describeContextWindowUsage(
  snapshot: ContextWindowSnapshot,
): ContextWindowUsageSummary {
  const used = formatContextWindowTokens(snapshot.usedTokens);
  const maxTokens = snapshot.maxTokens ?? null;
  const max = maxTokens !== null && maxTokens > 0 ? maxTokens : null;
  const percentage =
    max !== null && snapshot.usedPercentage !== null
      ? Math.max(0, Math.min(100, snapshot.usedPercentage))
      : null;
  const label =
    max !== null && percentage !== null
      ? `${formatUsedPercent(percentage)} used · ${used} of ${formatContextWindowTokens(max)} tokens`
      : `${used} tokens used`;

  const threshold = snapshot.autoCompactThreshold ?? null;
  const compactionNote =
    snapshot.compactsAutomatically && threshold !== null && threshold > 0
      ? max !== null
        ? `Compacts automatically near ${Math.min(100, Math.round((threshold / max) * 100))}%`
        : `Compacts automatically at ${formatContextWindowTokens(threshold)} tokens`
      : null;

  return {
    label,
    percent: percentage === null ? null : Math.round(percentage),
    warning: percentage !== null && percentage >= CONTEXT_WINDOW_WARNING_PERCENT,
    compactionNote,
    accessibilityLabel: [`Context window ${label}`, compactionNote].filter(Boolean).join(". "),
  };
}
