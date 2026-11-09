import { UsageDay, type UsageProviderKind, type UsageSummaryInput } from "@e6tools/contracts";
import { isModelCostUnknown, type ModelTotals } from "@e6tools/shared/usageMerge";
import { sharePercents } from "@e6tools/shared/usageShares";

const DAY_MS = 24 * 60 * 60_000;

function shiftDay(day: string, delta: number): UsageDay {
  const [year = 0, month = 1, dayOfMonth = 1] = day
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  return UsageDay.make(
    new Date(Date.UTC(year, month - 1, dayOfMonth + delta)).toISOString().slice(0, 10),
  );
}

function dayIn(instantMs: number, timeZone: string): UsageDay {
  return UsageDay.make(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instantMs),
  );
}

/**
 * The equal-length window that ends where `window` starts: the 7 calendar days
 * before a 7-day window, or the 24 hours before a rolling 24-hour one.
 */
export function previousWindow(window: UsageSummaryInput): UsageSummaryInput {
  if (window.sinceTime !== undefined && window.untilTime !== undefined) {
    const sinceMs = Date.parse(window.sinceTime);
    const untilMs = Date.parse(window.untilTime);
    const previousSince = sinceMs - (untilMs - sinceMs);
    return {
      ...window,
      sinceDay: dayIn(previousSince, window.timeZone),
      untilDay: dayIn(sinceMs, window.timeZone),
      sinceTime: new Date(previousSince).toISOString(),
      untilTime: window.sinceTime,
    };
  }
  const length = Math.round((Date.parse(window.untilDay) - Date.parse(window.sinceDay)) / DAY_MS);
  return {
    ...window,
    sinceDay: shiftDay(window.sinceDay, -(length + 1)),
    untilDay: shiftDay(window.sinceDay, -1),
  };
}

/** Changes this small read as noise, so they are worded as "about the same". */
const SAME_THRESHOLD_PERCENT = 3;

/**
 * `12% more than the 7 days before`, with the direction for its icon, or null
 * when the previous window has nothing to compare against.
 */
export function describePeriodChange(
  current: number,
  previous: number,
  periodLabel: string,
): { readonly direction: "more" | "less" | "same"; readonly text: string } | null {
  if (!(previous > 0)) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(percent) <= SAME_THRESHOLD_PERCENT) {
    return { direction: "same", text: `About the same as the ${periodLabel} before` };
  }
  const direction = percent > 0 ? "more" : "less";
  return {
    direction,
    text: `${Math.abs(percent)}% ${direction} than the ${periodLabel} before`,
  };
}

/** One part of the cost split: a model, or every smaller model folded together. */
interface ModelCostPart {
  readonly key: string;
  readonly label: string;
  /** Null for the folded remainder, which can span providers. */
  readonly provider: UsageProviderKind | null;
  readonly costUsd: number;
  readonly percent: number;
}

/**
 * The period's estimated cost by model, largest first, for "Where the cost
 * went". Models past `limit` fold into one "N other models" part so the bar
 * keeps a few readable steps; percents add up to exactly 100. Unpriced models
 * have no cost to split, so they are counted apart instead of shown as 0%.
 */
export function modelCostSplit(
  models: readonly ModelTotals[],
  limit = 4,
): { readonly parts: readonly ModelCostPart[]; readonly unpricedModels: number } {
  const priced = models
    .filter((model) => !isModelCostUnknown(model) && model.costUsd > 0)
    .toSorted((left, right) => right.costUsd - left.costUsd);
  // Folding a single model into "1 other model" hides its name for no gain.
  const shown = priced.length > limit + 1 ? priced.slice(0, limit) : priced;
  const rest = priced.slice(shown.length);
  const entries: Omit<ModelCostPart, "percent">[] = shown.map((model) => ({
    key: `${model.provider}:${model.model}`,
    label: model.model,
    provider: model.provider,
    costUsd: model.costUsd,
  }));
  if (rest.length > 0) {
    entries.push({
      key: "other",
      label: `${rest.length} other models`,
      provider: null,
      costUsd: rest.reduce((sum, model) => sum + model.costUsd, 0),
    });
  }
  const percents = sharePercents(entries.map((entry) => entry.costUsd));
  return {
    parts: entries.map((entry, index) => ({ ...entry, percent: percents[index] ?? 0 })),
    unpricedModels: models.filter(isModelCostUnknown).length,
  };
}
