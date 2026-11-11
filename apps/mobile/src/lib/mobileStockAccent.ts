import type { StockAccent } from "@e6tools/contracts/settings";
import { STOCK_ACCENT_PALETTES } from "@e6tools/shared/themePalettes";

import {
  DEFAULT_MOBILE_THEME_ID,
  flattenThemeColor,
  getMobileThemeColors,
  themeColorWithAlpha,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariables,
} from "./mobileTheme";

// Iris's inline-skill wash is the accent at about this strength over the
// canvas (#f2f1fd on Porcelain, #2a2a3d on Slate).
const SKILL_WASH_ALPHA = { light: 0.08, dark: 0.12 } as const;
// The merged wash matches web's --merged-surface: 8% on Porcelain, 16% on Slate.
const MERGED_WASH_ALPHA = { light: 0.08, dark: 0.16 } as const;

const NO_OVERRIDES: Partial<MobileThemeVariables> = {};

// The accent the registered stock palette already carries. It is not
// DEFAULT_STOCK_ACCENT: the default moved to Graphite while the generated
// palette stays Iris, so Graphite needs overrides like any other accent.
const PALETTE_ACCENT: StockAccent = "iris";

/**
 * The primary-family variables an accent replaces on the stock E6 Code
 * palette, plus the merged pull request family that pairs with it. Iris (the
 * palette's own accent) and every other theme (including Material You, which
 * brings the system accent) get no overrides, so they render exactly as
 * generated.
 */
export function getStockAccentVariableOverrides(
  themeId: MobileThemeId,
  accent: StockAccent,
  appearance: MobileThemeAppearance,
): Partial<MobileThemeVariables> {
  if (themeId !== DEFAULT_MOBILE_THEME_ID || accent === PALETTE_ACCENT) return NO_OVERRIDES;
  const colors = STOCK_ACCENT_PALETTES[accent][appearance];
  const canvas = getMobileThemeColors(DEFAULT_MOBILE_THEME_ID, appearance).canvas;
  return {
    "--color-primary": colors.primary,
    "--color-primary-foreground": colors.primaryForeground,
    "--color-primary-text": colors.primaryText,
    "--color-primary-edge": colors.primaryEdge,
    "--color-focus": colors.primary,
    "--color-switch-active-track": colors.primary,
    "--color-switch-active-thumb": colors.primaryForeground,
    "--color-md-link": colors.primaryText,
    "--color-user-bubble-skill-foreground": colors.primaryText,
    "--color-inline-skill-border": themeColorWithAlpha(colors.primary, 0.42),
    "--color-inline-skill-background": flattenThemeColor(
      themeColorWithAlpha(colors.primary, SKILL_WASH_ALPHA[appearance]),
      canvas,
    ),
    "--color-merged": flattenThemeColor(
      themeColorWithAlpha(colors.merged, MERGED_WASH_ALPHA[appearance]),
      canvas,
    ),
    "--color-merged-foreground": colors.mergedForeground,
  };
}

/** Slate's terminal cursor is the accent; Porcelain's is ink and never changes. */
export function getStockAccentTerminalCursor(
  themeId: MobileThemeId,
  accent: StockAccent,
  appearance: MobileThemeAppearance,
): string | null {
  if (themeId !== DEFAULT_MOBILE_THEME_ID || accent === PALETTE_ACCENT) return null;
  if (appearance === "light") return null;
  return STOCK_ACCENT_PALETTES[accent].dark.primary;
}
