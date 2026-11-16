/**
 * Layout tokens for redesigned screens (E01-T04, direction C "Lit Stage"): the 4 px grid,
 * row and control heights, the chat reading column, the panel gap and the breakpoints.
 * Lengths are `rem` at a 16 px root, so the Interface font size setting scales them as it
 * scales `--chat-max-width` today. Legacy names (`--panel-gap`, `--chat-max-width`) keep
 * their values; switching legacy screens over is the E08/E13 switch.
 */
import type { ChatWidth } from "@e6tools/contracts/settings";

import type { CssRule } from "./webStock.ts";

/** Space steps as multiples of Tailwind's `--spacing` (4 px); `1.5` is named `--space-1_5`. */
export const SPACE = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;

/** Row and control heights. `touch` keeps a 44 px floor at a small Interface font size. */
export const HEIGHTS = {
  /** Settled and snoozed shelf rows, tree rows, menu items. */
  "row-dense": "1.75rem",
  row: "2rem",
  /** Two-line active thread rows: `row` x 1.5. */
  "row-two-line": "3rem",
  control: "2rem",
  /** Hero composer actions, onboarding. */
  "control-lg": "2.5rem",
  /** Minimum target on mobile and touch web. */
  touch: "max(2.75rem, 44px)",
} as const;

/** The chat reading column per Chat width setting; the composer matches it. */
export const MEASURE_CHAT = {
  comfortable: "45rem",
  wide: "72rem",
  full: "100%",
} as const satisfies Record<ChatWidth, string>;

/** Gap between stage panels: none on mobile web, 10 px from the sheet breakpoint up. */
export const GAP_PANEL = { mobileWeb: "0px", desktop: "0.625rem" } as const;

/**
 * Viewport widths in px that screens must work at. `sheet` (sidebar becomes a sheet) and
 * `rightPanelSheet` (right panel becomes a sheet, inclusive) record today's legacy values.
 */
export const BREAKPOINTS = {
  mobileWeb: 360,
  compact: 640,
  sheet: 768,
  rightPanelSheet: 980,
  max: 2560,
} as const;

const chatWidthRule = (width: Exclude<ChatWidth, "comfortable">): CssRule => ({
  rule: `:root[data-chat-width="${width}"]`,
  body: [["--measure-chat", MEASURE_CHAT[width]]],
});

/** The `layout` block, under names legacy CSS never declares. */
export const LAYOUT: ReadonlyArray<CssRule> = [
  {
    rule: ":root",
    body: [
      ...SPACE.map(
        (steps) =>
          [
            `--space-${String(steps).replace(".", "_")}`,
            `calc(var(--spacing) * ${steps})`,
          ] as const,
      ),
      ...Object.entries(HEIGHTS).map(([name, value]) => [`--${name}`, value] as const),
      ["--measure-chat", MEASURE_CHAT.comfortable],
      ["--gap-panel", GAP_PANEL.mobileWeb],
      { rule: "@variant md", body: [["--gap-panel", GAP_PANEL.desktop]] },
    ],
  },
  chatWidthRule("wide"),
  chatWidthRule("full"),
  {
    // Utilities: `h-row`, `min-h-touch`, `size-control`, ... and `max-w-chat`. Spacing
    // utilities already are the 4 px grid (`p-1.5`, `gap-3`), so `--space-*` is CSS only.
    rule: "@theme inline",
    body: [
      ...Object.keys(HEIGHTS).map((name) => [`--spacing-${name}`, `var(--${name})`] as const),
      ["--container-chat", "var(--measure-chat)"],
    ],
  },
];

export const LAYOUT_BLOCKS = { layout: LAYOUT } as const;
