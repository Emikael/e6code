/**
 * Model rate lookup and cost arithmetic.
 *
 * Rates come from LiteLLM's `model_prices_and_context_window.json`, the same
 * table `ccusage` prices against. Everything here is pure: fetching and caching
 * the table lives in `UsageService`.
 *
 * @module usagePricing
 */
import type {
  ModelPriceTier,
  UsageCostSource,
  UsageModelPriceOverride,
  UsageTokenTotals,
} from "@e6tools/contracts";

/**
 * The subset of a LiteLLM entry we price against. All values are USD per token.
 *
 * LiteLLM also publishes tiered variants (`*_above_272k_tokens`, `*_flex`,
 * `*_priority`, `*_batches`). We deliberately price at the base tier: the
 * transcripts don't record which tier served a request, so anything else would
 * be a guess dressed up as precision.
 */
export interface ModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

/** Custom IDs keep their case, provider prefix, and variant suffix. */
export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken:
          (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken:
          (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
      },
    ]),
  );
}

/** Raw shape of one LiteLLM entry, narrowed to the fields we read. */
interface LiteLlmEntry {
  readonly input_cost_per_token?: unknown;
  readonly output_cost_per_token?: unknown;
  readonly cache_read_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost?: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Projects the LiteLLM document into a rate table.
 *
 * Entries without both an input and an output rate are dropped: a half-priced
 * model would silently under-report cost, which is worse than reporting the
 * model as unpriced.
 *
 * Entries keep their full normalized key; a bare name is aliased only when no
 * canonical entry exists and every qualified entry has the same rate.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const input = finiteNumber(entry.input_cost_per_token);
    const output = finiteNumber(entry.output_cost_per_token);
    if (input === null || output === null) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    table.set(key, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      // Anthropic bills cache reads at a discount and cache writes at a
      // premium. When a model omits them, cached input is priced as plain
      // input rather than as free.
      cacheReadCostPerToken: finiteNumber(entry.cache_read_input_token_cost) ?? input,
      cacheCreationCostPerToken: finiteNumber(entry.cache_creation_input_token_cost) ?? input,
    });
  }

  // `null` marks a bare name claimed at conflicting rates: no alias for it.
  const aliasCandidates = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliasCandidates.get(alias);
    if (held === undefined) {
      aliasCandidates.set(alias, rate);
    } else if (held !== null && !sameRate(held, rate)) {
      aliasCandidates.set(alias, null);
    }
  }
  for (const [alias, rate] of aliasCandidates) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken
  );
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

/**
 * Drops a bracketed variant suffix such as `claude-fable-5-1[1m]`, which
 * Claude Code writes for the 1M context tier. The rate table only knows the
 * base name, and we price at the base tier anyway.
 */
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  return bracket === -1 ? key : key.slice(0, bracket);
}

/**
 * Models we never price, regardless of the table.
 *
 * `<synthetic>` marks locally generated messages that were never billed. Bare
 * family names ("opus", "sonnet") are genuinely ambiguous across generations,
 * so we report them as unpriced instead of guessing a generation.
 */
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;
  return table.get(key) ?? null;
}

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
}

/**
 * Prices a bucket's tokens.
 *
 * `reasoningTokens` is intentionally not charged separately: it is already
 * counted inside `outputTokens`.
 */
export function priceUsage(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  reportedCostUsd: number | null,
  overrides?: RateTable,
): PricedUsage {
  const override = overrides?.get(model.trim());
  if (override === undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd)) {
    return { costUsd: reportedCostUsd, costSource: "providerReported" };
  }

  const rate = override ?? lookupRate(table, model);
  if (rate === null) return { costUsd: 0, costSource: "unpriced" };

  const costUsd =
    totals.uncachedInputTokens * rate.inputCostPerToken +
    totals.cachedInputTokens * rate.cacheReadCostPerToken +
    totals.cacheCreationTokens * rate.cacheCreationCostPerToken +
    totals.outputTokens * rate.outputCostPerToken;

  return { costUsd, costSource: "modelPriced" };
}

/**
 * What the cached input would have cost at full input rates, minus what it
 * actually cost. Drives the "cache savings" figure.
 */
export function cacheSavingsUsd(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  overrides?: RateTable,
): number {
  const rate = overrides?.get(model.trim()) ?? lookupRate(table, model);
  if (rate === null) return 0;
  return totals.cachedInputTokens * (rate.inputCostPerToken - rate.cacheReadCostPerToken);
}

/**
 * Blended USD per million tokens: three input tokens per output token, the
 * usual convention for comparing list prices. Coding agents read far more than
 * they write, so this tracks real spend better than an even split.
 */
function blendedCostPerMillionTokens(rate: ModelRate): number {
  return ((3 * rate.inputCostPerToken + rate.outputCostPerToken) / 4) * 1_000_000;
}

/**
 * Exclusive upper bounds, in blended USD per million tokens, of picker price
 * tiers 1 and 2; anything at or above the second is tier 3. Drawn from the
 * table's own spread: mini, flash, and haiku-class models sit under $2,
 * mid-size coding models between $2 and $7.50, frontier models above.
 */
const PRICE_TIER_UPPER_BOUNDS_USD = [2, 7.5] as const;

function priceTierForRate(rate: ModelRate): ModelPriceTier {
  const blended = blendedCostPerMillionTokens(rate);
  if (blended < PRICE_TIER_UPPER_BOUNDS_USD[0]) return 1;
  if (blended < PRICE_TIER_UPPER_BOUNDS_USD[1]) return 2;
  return 3;
}

/**
 * Reasoning-effort suffixes some providers bake into model IDs, such as
 * Antigravity's `gemini-3.8-flash-high`. The effort changes how many tokens a
 * turn uses, not the per-token rate.
 */
const EFFORT_SUFFIX = /-(?:minimal|low|medium|high|xhigh|max)$/i;

/**
 * The model picker's price tier for a slug, or undefined when nothing prices
 * it. Custom prices win, as on the Usage page. Otherwise the slug is tried as
 * is, then as its bare model name when provider-qualified (OpenCode's
 * `anthropic/claude-…`), then without an effort suffix. Each fallback only
 * finds a rate the table holds unambiguously: a canonical entry, or a bare
 * alias every qualified entry agrees on.
 */
export function lookupModelPriceTier(
  table: RateTable,
  model: string,
  overrides?: RateTable,
): ModelPriceTier | undefined {
  const trimmed = model.trim();
  const bareName = bareModelName(trimmed);
  const withoutEffort = bareName.replace(EFFORT_SUFFIX, "");
  const rate =
    overrides?.get(trimmed) ??
    lookupRate(table, trimmed) ??
    (bareName !== trimmed ? lookupRate(table, bareName) : null) ??
    (withoutEffort !== bareName ? lookupRate(table, withoutEffort) : null);
  return rate === null ? undefined : priceTierForRate(rate);
}
