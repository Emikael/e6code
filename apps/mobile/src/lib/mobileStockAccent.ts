import { DEFAULT_STOCK_ACCENT, type StockAccent } from "@e6tools/contracts/settings";
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

const NO_OVERRIDES: Partial<MobileThemeVariables> = {};

/**
 * The primary-family variables an accent replaces on the stock E6 Code
 * palette. Iris and every other theme (including Material You, which brings
 * the system accent) get no overrides, so they render exactly as generated.
 */
export function getStockAccentVariableOverrides(
  themeId: MobileThemeId,
  accent: StockAccent,
  appearance: MobileThemeAppearance,
): Partial<MobileThemeVariables> {
  if (themeId !== DEFAULT_MOBILE_THEME_ID || accent === DEFAULT_STOCK_ACCENT) return NO_OVERRIDES;
  const colors = STOCK_ACCENT_PALETTES[accent][appearance];
  const canvas = getMobileThemeColors(DEFAULT_MOBILE_THEME_ID, appearance).canvas;
  return {
    "--color-primary": colors.primary,
    "--color-primary-foreground": colors.primaryForeground,
    "--color-primary-text": colors.primaryText,
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
  };
}

/** Slate's terminal cursor is the accent; Porcelain's is ink and never changes. */
export function getStockAccentTerminalCursor(
  themeId: MobileThemeId,
  accent: StockAccent,
  appearance: MobileThemeAppearance,
): string | null {
  if (themeId !== DEFAULT_MOBILE_THEME_ID || accent === DEFAULT_STOCK_ACCENT) return null;
  if (appearance === "light") return null;
  return STOCK_ACCENT_PALETTES[accent].dark.primary;
}
