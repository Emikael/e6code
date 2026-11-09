import { UsageDay, type UsageSummaryInput } from "@e6tools/contracts";

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

/**
 * Whole-number percentages of `values` that add up to exactly 100, by largest
 * remainder, so a legend never reads 99% or 101%. All zeros give all zeros.
 */
export function sharePercents(values: readonly number[]): readonly number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0)) return values.map(() => 0);
  const exact = values.map((value) => (Math.max(0, value) / total) * 100);
  const floored = exact.map(Math.floor);
  let leftover = 100 - floored.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .toSorted((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    floored[index] = (floored[index] ?? 0) + 1;
    leftover -= 1;
  }
  return floored;
}

/**
 * Whole-number percent of input read from cache, or null with no input. Cache
 * writes count as input that did not come from cache.
 */
export function cachedInputPercent(totals: TokenTotals): number | null {
  const input = totals.uncachedInputTokens + totals.cachedInputTokens + totals.cacheCreationTokens;
  return input > 0 ? Math.round((totals.cachedInputTokens / input) * 100) : null;
}

interface TokenTotals {
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

/**
 * Where the period's tokens went: the three disjoint input parts and output,
 * whose percentages add up to 100. Reasoning is a subset of output, so it is
 * reported as a share of output rather than as a fifth part.
 */
export function tokenSplit(totals: TokenTotals) {
  const parts = [
    { key: "uncached", label: "Input, uncached", tokens: totals.uncachedInputTokens },
    { key: "cacheRead", label: "Input, cache read", tokens: totals.cachedInputTokens },
    { key: "cacheWrite", label: "Input, cache write", tokens: totals.cacheCreationTokens },
    { key: "output", label: "Output", tokens: totals.outputTokens },
  ] as const;
  const percents = sharePercents(parts.map((part) => part.tokens));
  const reasoningTokens = Math.min(totals.reasoningTokens, totals.outputTokens);
  return {
    totalTokens: parts.reduce((sum, part) => sum + part.tokens, 0),
    parts: parts.map((part, index) => ({ ...part, percent: percents[index] ?? 0 })),
    reasoning: {
      tokens: reasoningTokens,
      percentOfOutput:
        totals.outputTokens > 0 ? Math.round((reasoningTokens / totals.outputTokens) * 100) : 0,
    },
  };
}
