import type { ModelPriceTier } from "@e6tools/contracts";

/** The model picker's secondary details, e.g. "1M context · $$$". */
interface ModelMetaParts {
  /** "200K context". */
  readonly context?: string;
  /** "$$$". Read it out with `priceAccessibilityLabel` instead. */
  readonly price?: string;
  /** "Price tier: high". */
  readonly priceAccessibilityLabel?: string;
}

const PRICE_TIER_NAMES: Record<ModelPriceTier, string> = { 1: "low", 2: "medium", 3: "high" };

/** 200_000 → "200K", 1_000_000 → "1M", 1_050_000 → "1.1M". */
function formatContextWindowTokens(tokens: number): string {
  const thousands = Math.round(tokens / 1_000);
  if (thousands >= 1_000) {
    return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  }
  return thousands >= 1 ? `${thousands}K` : String(tokens);
}

/** Missing inputs leave their part out, so a model with neither gets `{}`. */
export function modelMetaParts(model: {
  readonly contextWindowTokens?: number | undefined;
  readonly priceTier?: ModelPriceTier | undefined;
}): ModelMetaParts {
  return {
    ...(model.contextWindowTokens
      ? { context: `${formatContextWindowTokens(model.contextWindowTokens)} context` }
      : {}),
    ...(model.priceTier
      ? {
          price: "$".repeat(model.priceTier),
          priceAccessibilityLabel: `Price tier: ${PRICE_TIER_NAMES[model.priceTier]}`,
        }
      : {}),
  };
}
