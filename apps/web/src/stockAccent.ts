import type { StockAccent } from "@e6tools/contracts/settings";
import {
  STOCK_ACCENT_PALETTES,
  type StockAccentColors,
  type ThemeAppearance,
} from "@e6tools/shared/themePalettes";

import { getThemeDefinition, resolveThemeHalf, type ThemeHalves } from "./themePalette";

const STOCK_ACCENT_VARIABLE_NAMES: Readonly<Record<keyof StockAccentColors, string>> = {
  primary: "--stock-primary",
  primaryForeground: "--stock-primary-foreground",
  primaryHover: "--stock-primary-hover",
  primaryEdge: "--stock-primary-edge",
  primaryText: "--stock-primary-text",
};

function stockAccentVariableName(role: keyof StockAccentColors, appearance: ThemeAppearance) {
  const name = STOCK_ACCENT_VARIABLE_NAMES[role];
  return appearance === "dark" ? `${name}-dark` : name;
}

/**
 * Inline variables the stock tokens in index.css read before their Iris
 * fallbacks. Both appearances are written at once so a light/dark switch
 * needs no re-run. Iris writes nothing and lets the stylesheet stand.
 */
export function stockAccentVariables(accent: StockAccent): Readonly<Record<string, string>> {
  if (accent === "iris") return {};
  const palette = STOCK_ACCENT_PALETTES[accent];
  const variables: Record<string, string> = {};
  for (const appearance of ["light", "dark"] as const) {
    for (const [role, value] of Object.entries(palette[appearance]) as Array<
      [keyof StockAccentColors, string]
    >) {
      variables[stockAccentVariableName(role, appearance)] = value;
    }
  }
  return variables;
}

export function applyStockAccent(root: HTMLElement, accent: StockAccent): void {
  const variables = stockAccentVariables(accent);
  for (const appearance of ["light", "dark"] as const) {
    for (const role of Object.keys(STOCK_ACCENT_VARIABLE_NAMES) as Array<keyof StockAccentColors>) {
      const name = stockAccentVariableName(role, appearance);
      const value = variables[name];
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  }
}

/**
 * Whether the palette on screen is the stock E6 Code theme, the only one the
 * accent override reaches. A theme mix can put a library theme on one half.
 */
export function isStockThemeActive(
  theme: string,
  halves: ThemeHalves | null,
  appearance: ThemeAppearance,
): boolean {
  return getThemeDefinition(resolveThemeHalf(theme, halves, appearance)) === null;
}
