/**
 * Token share maths for the usage page, shared by web and mobile so both show
 * the same percentages.
 *
 * @module usageShares
 */

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
  // map returns a fresh array, so sorting it in place is safe; Hermes (mobile) has no toSorted.
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
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
