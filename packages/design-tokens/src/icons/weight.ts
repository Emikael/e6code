/**
 * The weight rule (D2a) on its own, so a generated icon component can import it without loading
 * the registry's data. `@e6tools/design-tokens/icons` re-exports it unchanged.
 */

export type IconWeight = "regular" | "bold" | "fill" | "duotone";

/** `active`: the selected sidebar destination, the active panel tab, a pinned thread. */
export type IconState = "rest" | "active";

/** The only entry fields the weight rule reads, so a generated component can bake them. */
export interface IconWeightTraits {
  /**
   * Fills when selected or active. False where Phosphor's fill is not the same silhouette
   * filled (a knock-out tile for close, add, check, code, terminal) and for carets and arrows.
   */
  readonly fillWhenActive: boolean;
  /** May render duotone as an empty-state illustration. */
  readonly illustration?: true;
}

/**
 * Weights carry state: regular at rest, fill for the selected or active thing, bold where a
 * regular stroke breaks up (12 to 14 px), duotone for empty-state illustrations.
 */
export const ICON_WEIGHT_RULES = { boldAtOrBelowPx: 14 } as const;

/** The weight to draw an entry in. Fill beats small-size bold: a silhouette needs no stroke help. */
export function iconWeight(
  traits: IconWeightTraits,
  options: { readonly sizePx: number; readonly state?: IconState; readonly illustration?: boolean },
): IconWeight {
  if (options.illustration && traits.illustration) return "duotone";
  if (options.state === "active" && traits.fillWhenActive) return "fill";
  if (options.sizePx <= ICON_WEIGHT_RULES.boldAtOrBelowPx) return "bold";
  return "regular";
}

/** Every weight an entry can resolve to, so the generator emits only those. */
export function iconWeightsFor(traits: IconWeightTraits): ReadonlyArray<IconWeight> {
  const weights: Array<IconWeight> = ["regular", "bold"];
  if (traits.fillWhenActive) weights.push("fill");
  if (traits.illustration) weights.push("duotone");
  return weights;
}
