import type { CssRule } from "./webStock.ts";

/** The `layout` block of `index.css`. E01-T04 fills it with spacing, heights and measures. */
export const LAYOUT_BLOCKS = {
  layout: { rule: "@theme", body: [] },
} as const satisfies Record<string, CssRule>;
