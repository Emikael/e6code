import type { IconName } from "@e6tools/design-tokens/icons";
import {
  iconWeight,
  type IconState,
  type IconWeight,
  type IconWeightTraits,
} from "@e6tools/design-tokens/iconWeight";
import type { CSSProperties, ReactElement, ReactNode } from "react";

export type IconSize = 14 | 16 | 20;

export interface IconProps {
  /**
   * Nominal px at a 16 px root; the svg pins its box in rem, so it follows the interface font
   * size. Default 16. It also picks the weight (bold at 14 px). Never size an icon with a class.
   */
  readonly size?: IconSize;
  /**
   * Default "rest". "active" fills entries whose fill is their silhouette and otherwise keeps the
   * size's weight. It changes the drawing only: the control carries aria-current, aria-selected
   * or aria-pressed.
   */
  readonly state?: IconState;
  /**
   * Set only when the icon alone carries meaning and no visible text already says the same thing.
   * Then the svg gets role="img" and this aria-label; otherwise it is aria-hidden.
   */
  readonly label?: string;
  /** Colour (a semantic text role, read through currentColor) and layout only. */
  readonly className?: string;
}

/**
 * One drawing per weight, as SVG children on the 256 grid. Provisional: ENG-96 settles the shape
 * against Phosphor's raw SVGs.
 */
export type IconArtworkByWeight = { readonly regular: ReactNode } & Partial<
  Record<Exclude<IconWeight, "regular">, ReactNode>
>;

// Inline style beats the legacy `[&_svg:not([class*='size-'])]:size-*` rules, which would
// otherwise draw 14 px bold artwork at another size. Hoisted so every render reuses one object.
const ICON_BOX_STYLE = {
  14: { width: "0.875rem", height: "0.875rem", flexShrink: 0 },
  16: { width: "1rem", height: "1rem", flexShrink: 0 },
  20: { width: "1.25rem", height: "1.25rem", flexShrink: 0 },
} as const satisfies Record<IconSize, CSSProperties>;

const iconBoxStyle = (size: IconSize) => ICON_BOX_STYLE[size];

/** A non-blank label names the icon as an image; anything else hides it from assistive tech. */
export function iconA11yAttributes(
  label: string | undefined,
): { readonly role: "img"; readonly "aria-label": string } | { readonly "aria-hidden": true } {
  return label !== undefined && label.trim() !== ""
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true };
}

/** The drawing for the weight `iconWeight` picks; a weight without a drawing draws regular. */
export function selectIconArtwork(
  artwork: IconArtworkByWeight,
  traits: IconWeightTraits,
  options: { readonly size: IconSize; readonly state: IconState },
): ReactNode {
  const weight = iconWeight(traits, { sizePx: options.size, state: options.state });
  return artwork[weight] ?? artwork.regular;
}

/**
 * The svg every icon renders. Only generated components (which bake `name`, `traits` and
 * `artwork`) and the dynamic loader's placeholder render it; feature code never does.
 * `artwork: null` draws an empty box of the same size, without `data-icon`, so `data-icon`
 * always means the artwork is drawn.
 */
export function IconSvg({
  name,
  traits,
  artwork,
  size = 16,
  state = "rest",
  label,
  className,
}: IconProps & {
  readonly name: IconName;
  readonly traits: IconWeightTraits;
  readonly artwork: IconArtworkByWeight | null;
}): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      style={iconBoxStyle(size)}
      fill="currentColor"
      data-icon={artwork === null ? undefined : name}
      className={className}
      {...iconA11yAttributes(label)}
    >
      {artwork === null ? null : selectIconArtwork(artwork, traits, { size, state })}
    </svg>
  );
}
