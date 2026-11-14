import { DEFAULT_STOCK_ACCENT, type StockAccent } from "@e6tools/contracts/settings";
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
  merged: "--stock-merged",
  mergedForeground: "--stock-merged-foreground",
};

function stockAccentVariableName(role: keyof StockAccentColors, appearance: ThemeAppearance) {
  const name = STOCK_ACCENT_VARIABLE_NAMES[role];
  return appearance === "dark" ? `${name}-dark` : name;
}

/** `#rrggbb` as space-separated `rgb()` with an alpha, the form index.css uses. */
function translucentHex(hex: string, alphaPercent: number): string {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${r} ${g} ${b} / ${alphaPercent}%)`;
}

// Selection washes match the stock tokens in index.css: 18% on Porcelain, 22% on Slate.
const TERMINAL_SELECTION_ALPHA = { light: 18, dark: 22 } as const;

/**
 * Inline variables the stock tokens in index.css read before their Graphite
 * fallbacks. Both appearances are written at once so a light/dark switch
 * needs no re-run. The default accent (Graphite) writes nothing and lets the
 * stylesheet stand. The terminal colors are resolved here rather than with
 * color-mix() because the terminal reads them back as computed values. The
 * boot script in index.html writes the same variables before first paint.
 */
export function stockAccentVariables(accent: StockAccent): Readonly<Record<string, string>> {
  if (accent === DEFAULT_STOCK_ACCENT) return {};
  const palette = STOCK_ACCENT_PALETTES[accent];
  const variables: Record<string, string> = {};
  for (const appearance of ["light", "dark"] as const) {
    for (const [role, value] of Object.entries(palette[appearance]) as Array<
      [keyof StockAccentColors, string]
    >) {
      variables[stockAccentVariableName(role, appearance)] = value;
    }
  }
  variables["--stock-terminal-selection"] = translucentHex(
    palette.light.primary,
    TERMINAL_SELECTION_ALPHA.light,
  );
  variables["--stock-terminal-selection-dark"] = translucentHex(
    palette.dark.primary,
    TERMINAL_SELECTION_ALPHA.dark,
  );
  // Porcelain's cursor is ink, not accent; only Slate's follows the accent.
  variables["--stock-terminal-cursor-dark"] = palette.dark.primary;
  return variables;
}

const STOCK_ACCENT_VARIABLES = Object.keys(stockAccentVariables("cobalt"));

export function applyStockAccent(root: HTMLElement, accent: StockAccent): void {
  const variables = stockAccentVariables(accent);
  for (const name of STOCK_ACCENT_VARIABLES) {
    const value = variables[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
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
