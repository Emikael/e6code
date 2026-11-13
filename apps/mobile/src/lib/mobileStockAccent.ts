import { DEFAULT_STOCK_ACCENT, type StockAccent } from "@e6tools/contracts/settings";
import { STOCK_ACCENT_PALETTES } from "@e6tools/shared/themePalettes";

import {
  DEFAULT_MOBILE_THEME_ID,
  stockAccentVariables,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariables,
} from "./mobileTheme";

const NO_OVERRIDES: Partial<MobileThemeVariables> = {};

// The stock terminal palette's cursor is still Iris's.
const TERMINAL_PALETTE_ACCENT: StockAccent = "iris";

/**
 * The primary-family variables an accent replaces on the stock E6 Code
 * palette, plus the merged pull request family that pairs with it. The
 * default accent (the generated palette already wears it) and every other
 * theme (including Material You, which brings the system accent) get no
 * overrides, so they render exactly as generated.
 */
export function getStockAccentVariableOverrides(
  themeId: MobileThemeId,
  accent: StockAccent,
  appearance: MobileThemeAppearance,
): Partial<MobileThemeVariables> {
  if (themeId !== DEFAULT_MOBILE_THEME_ID || accent === DEFAULT_STOCK_ACCENT) return NO_OVERRIDES;
  return stockAccentVariables(accent, appearance);
}

/** Slate's terminal cursor is the accent; Porcelain's is ink and never changes. */
export function getStockAccentTerminalCursor(
  themeId: MobileThemeId,
  accent: StockAccent,
  appearance: MobileThemeAppearance,
): string | null {
  if (themeId !== DEFAULT_MOBILE_THEME_ID || accent === TERMINAL_PALETTE_ACCENT) return null;
  if (appearance === "light") return null;
  return STOCK_ACCENT_PALETTES[accent].dark.primary;
}
