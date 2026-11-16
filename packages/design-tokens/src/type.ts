import type { CssRule } from "./webStock.ts";

/** The `type` block of `index.css`. E01-T12 fills it from `TYPE_SCALE` in `keyLight.ts`. */
export const TYPE_BLOCKS = {
  type: { rule: "@theme", body: [] },
} as const satisfies Record<string, CssRule>;
