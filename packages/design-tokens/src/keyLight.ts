/**
 * Key Light tokens, direction C "Lit Stage" (ENG-141): planes, edges, light, elevation and
 * the motion scale, under names no legacy CSS declares. Legacy roles keep their values; the
 * retune of those roles is E01-T11.
 *
 * Stock (no `data-theme-id`) carries direction C literals. Under a theme every plane derives
 * from the theme's background, and edges, light and scrim are mixed from roles, so custom,
 * imported and environment-published themes need no new field. Mobile colour
 * keys are E01-T18.
 */
import { DUR, EASE } from "./motion.ts";
import type { CssRule } from "./webStock.ts";

const durations = Object.entries(DUR).map(([name, ms]) => [`--dur-${name}`, `${ms}ms`] as const);
const easings = (["enter", "expo", "shift", "exit"] as const).map(
  (name) => [`--ease-${name}`, EASE[name]] as const,
);

/** Ink at `percent`, boosted by the Contrast setting exactly as `--contrast-border` is. */
const edge = (percent: number) =>
  `color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, var(--foreground) ${percent}%, transparent) var(--appearance-contrast-base), transparent), var(--foreground) var(--appearance-contrast-border-boost))`;
const tint = (role: string, percent: number) =>
  `color-mix(in oklab, var(${role}) ${percent}%, transparent)`;

/** The `key-light` block, in cascade order. Rendered after the contrast recompute block. */
export const KEY_LIGHT: ReadonlyArray<CssRule> = [
  {
    // Stock literals live on `:root` only, so the sidebar subtree never re-declares them
    // over a theme's values.
    rule: ":root",
    body: [
      ["--plane-ground", "#f0f1f4"],
      ["--plane-stage", "#ffffff"],
      ["--plane-well", "#f3f4f6"],
      ["--plane-raised", "#ffffff"],
      ["--plane-float", "#ffffff"],
      { comment: "Not used by any light elevation; kept so a light rim can be drawn." },
      ["--light-rim", "rgb(255 255 255 / 72%)"],
      {
        comment:
          "Shadow stacks only: the 1 px edge is a border in --edge-*, so it follows the\nContrast setting. --elev-4 adds the scrim as its own element.",
      },
      ["--elev-0", "none"],
      ["--elev-1", "0 1px 2px rgb(20 22 27 / 6%), 0 20px 50px -24px rgb(20 22 27 / 22%)"],
      ["--elev-2", "0 1px 3px rgb(20 22 27 / 7%)"],
      ["--elev-3", "0 20px 44px -16px rgb(20 22 27 / 26%), 0 2px 6px rgb(20 22 27 / 6%)"],
      ["--elev-4", "var(--elev-3)"],
      ...durations,
      ...easings,
      {
        rule: "@variant dark",
        body: [
          ["--plane-ground", "#08090b"],
          ["--plane-stage", "#16181d"],
          ["--plane-well", "#0f1115"],
          ["--plane-raised", "#1b1e25"],
          ["--plane-float", "#1c1f26"],
          ["--light-rim", "rgb(255 255 255 / 8%)"],
          ["--elev-1", "inset 0 1px 0 rgb(255 255 255 / 6%), 0 30px 80px -30px rgb(0 0 0 / 85%)"],
          ["--elev-2", "inset 0 1px 0 var(--light-rim)"],
          ["--elev-3", "inset 0 1px 0 var(--light-rim), 0 20px 48px -16px rgb(0 0 0 / 72%)"],
        ],
      },
    ],
  },
  {
    // Mixed from roles, and recomputed wherever a subtree owns its own palette.
    rule: ":root, [data-app-sidebar]",
    body: [
      ["--edge-subtle", edge(8)],
      ["--edge-strong", edge(15)],
      ["--light-key", tint("--primary", 15)],
      ["--light-attention", tint("--warning", 12)],
      ["--scrim", tint("--foreground", 30)],
      {
        comment:
          "Ambient light (ENG-136): rays are light, not colour, on light grounds; the accent\nonly tints them near the source, by --ray-tint (a 0 to 1 amount).",
      },
      ["--light-ray", tint("--plane-stage", 92)],
      ["--ray-tint", "0.45"],
      {
        rule: "@variant dark",
        body: [
          ["--edge-subtle", edge(6)],
          ["--edge-strong", edge(12)],
          ["--light-key", tint("--primary", 30)],
          ["--light-attention", tint("--warning", 22)],
          ["--scrim", tint("--plane-ground", 66)],
          ["--light-ray", "var(--light-key)"],
          ["--ray-tint", "0"],
        ],
      },
    ],
  },
  {
    // Themes have no plane roles: the stage takes the theme's background and the other
    // planes are fixed oklab steps toward black or white, matched to the stock steps, so
    // the Lit Stage order holds on any palette (ENG-141). Specificity (0,2,1) beats `:root`
    // dark.
    rule: 'html[data-theme-id]:not([data-theme-id=""])',
    body: [
      ["--plane-stage", "var(--background)"],
      ["--plane-ground", "color-mix(in oklab, var(--plane-stage) 96%, black)"],
      ["--plane-well", "color-mix(in oklab, var(--plane-stage) 97%, black)"],
      ["--plane-raised", "var(--plane-stage)"],
      ["--plane-float", "var(--plane-stage)"],
      {
        rule: "@variant dark",
        body: [
          {
            // A near-black background lifts to oklab L 0.16 so the ground can still sit
            // below it. oklab, not oklch: oklch drops a near-neutral hue to `none`. Without
            // relative colour support the stage stays the background; order still holds.
            rule: "@supports (color: oklab(from red l a b))",
            body: [["--plane-stage", "oklab(from var(--background) max(l, 0.16) a b)"]],
          },
          ["--plane-ground", "color-mix(in oklab, var(--plane-stage) 63%, black)"],
          ["--plane-well", "color-mix(in oklab, var(--plane-stage) 84%, black)"],
          ["--plane-raised", "color-mix(in oklab, var(--plane-stage) 96%, white)"],
          ["--plane-float", "color-mix(in oklab, var(--plane-stage) 95%, white)"],
        ],
      },
    ],
  },
  {
    rule: "@theme inline",
    body: [
      ["--color-plane-ground", "var(--plane-ground)"],
      ["--color-plane-stage", "var(--plane-stage)"],
      ["--color-plane-well", "var(--plane-well)"],
      ["--color-plane-raised", "var(--plane-raised)"],
      ["--color-plane-float", "var(--plane-float)"],
      ["--color-edge-subtle", "var(--edge-subtle)"],
      ["--color-edge-strong", "var(--edge-strong)"],
      ["--color-light-key", "var(--light-key)"],
      ["--color-light-attention", "var(--light-attention)"],
      ["--color-scrim", "var(--scrim)"],
      ["--shadow-elev-1", "var(--elev-1)"],
      ["--shadow-elev-2", "var(--elev-2)"],
      ["--shadow-elev-3", "var(--elev-3)"],
    ],
  },
];

export const KEY_LIGHT_BLOCKS = { "key-light": KEY_LIGHT } as const;

/** How each plane is drawn, for the E01-T10 `Plane` primitive. */
export const PLANE_RECIPES = {
  ground: { background: "--plane-ground", edge: null, elevation: "--elev-0" },
  stage: { background: "--plane-stage", edge: "--edge-subtle", elevation: "--elev-1" },
  well: { background: "--plane-well", edge: "--edge-subtle", elevation: "--elev-0" },
  raised: { background: "--plane-raised", edge: "--edge-subtle", elevation: "--elev-2" },
  float: { background: "--plane-float", edge: "--edge-strong", elevation: "--elev-3" },
} as const;

type TypeStep = {
  readonly size: string;
  readonly lineHeight: string;
  readonly weight: string;
  readonly tracking: string;
  readonly maxSize?: string;
};

/**
 * The type scale in `rem` at a 16 px root, so the Interface font size setting scales it.
 * E01-T12 emits it. Strong weights fall back through `--weight-strong` for faces without a
 * weight axis, where 650 would otherwise resolve to bold.
 */
export const TYPE_SCALE = {
  micro: { size: "0.6875rem", lineHeight: "0.875rem", weight: "500", tracking: "0.01em" },
  label: { size: "0.75rem", lineHeight: "1rem", weight: "500", tracking: "0" },
  ui: { size: "0.8125rem", lineHeight: "1.125rem", weight: "400", tracking: "0" },
  body: { size: "0.875rem", lineHeight: "1.3125rem", weight: "400", tracking: "0" },
  /** Chat text; user-scalable 13 to 18 px through the E01-T12 setting. */
  prose: { size: "0.9375rem", lineHeight: "1.5rem", weight: "400", tracking: "0" },
  title: { size: "0.9375rem", lineHeight: "1.25rem", weight: "600", tracking: "-0.01em" },
  heading: {
    size: "1.1875rem",
    lineHeight: "1.5rem",
    weight: "var(--weight-strong, 650)",
    tracking: "-0.02em",
  },
  displayS: {
    size: "1.625rem",
    lineHeight: "1.875rem",
    weight: "var(--weight-strong, 650)",
    tracking: "-0.025em",
  },
  display: {
    size: "2.25rem",
    lineHeight: "2.5rem",
    weight: "var(--weight-strong, 650)",
    tracking: "-0.03em",
  },
  /** Marketing only: 48 to 72 px. */
  displayL: {
    size: "3rem",
    maxSize: "4.5rem",
    lineHeight: "1.05",
    weight: "var(--weight-strong, 650)",
    tracking: "-0.03em",
  },
} as const satisfies Record<string, TypeStep>;

/**
 * Radii in `rem`, emitted by E01-T10. New names because `--radius-sm|md|lg|xl` and
 * `--radius-panel` (14 px) already size legacy UI; `stage` is direction C's 16 px panel.
 * Nested radii: outer = inner + padding, within 2 px.
 */
export const RADII = {
  kbd: "0.25rem",
  chip: "0.375rem",
  control: "0.5rem",
  card: "0.75rem",
  stage: "1rem",
  overlay: "1rem",
} as const;
