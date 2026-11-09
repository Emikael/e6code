import { StockAccent } from "@e6tools/contracts/settings";
import {
  E6_CODE_DARK_MOBILE_PANE_COLORS,
  E6_CODE_DARK_THEME_COLORS,
  E6_CODE_LIGHT_THEME_COLORS,
  STOCK_ACCENT_PALETTES,
} from "@e6tools/shared/themePalettes";
import { differenceCiede2000 } from "culori/fn";
import { describe, expect, it } from "vite-plus/test";

import { isStockThemeActive, stockAccentVariables } from "./stockAccent";

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const colorDifference = differenceCiede2000();

function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Every opaque ground the accent sits on: Porcelain's canvas, surfaces, pane
// and wells; Slate's canvas, surfaces, wells, desktop pane and mobile drawer.
const GROUNDS = {
  light: [
    E6_CODE_LIGHT_THEME_COLORS.canvas,
    E6_CODE_LIGHT_THEME_COLORS.surface,
    E6_CODE_LIGHT_THEME_COLORS.surfaceRaised,
    E6_CODE_LIGHT_THEME_COLORS.sidebar,
    E6_CODE_LIGHT_THEME_COLORS.secondary,
  ],
  dark: [
    E6_CODE_DARK_THEME_COLORS.canvas,
    E6_CODE_DARK_THEME_COLORS.surface,
    E6_CODE_DARK_THEME_COLORS.surfaceRaised,
    E6_CODE_DARK_THEME_COLORS.sidebar,
    E6_CODE_DARK_THEME_COLORS.secondary,
    E6_CODE_DARK_MOBILE_PANE_COLORS.sidebar,
  ],
} as const;

describe("stock accent palettes", () => {
  it("keeps Iris identical to the stock E6 Code tokens", () => {
    for (const [appearance, stock] of [
      ["light", E6_CODE_LIGHT_THEME_COLORS],
      ["dark", E6_CODE_DARK_THEME_COLORS],
    ] as const) {
      const iris = STOCK_ACCENT_PALETTES.iris[appearance];
      expect(iris.primary).toBe(stock.messageAction);
      expect(iris.primaryForeground).toBe(stock.messageActionForeground);
      expect(iris.primaryHover).toBe(stock.messageActionHover);
      expect(iris.primary).toBe(stock.focus);
    }
  });

  describe.each(StockAccent.literals)("%s", (accent) => {
    it.each(["light", "dark"] as const)("is readable in %s", (appearance) => {
      const colors = STOCK_ACCENT_PALETTES[accent][appearance];
      // Ink on the fill, at rest and hovered.
      expect(contrastRatio(colors.primaryForeground, colors.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.primaryForeground, colors.primaryHover)).toBeGreaterThanOrEqual(
        4.5,
      );
      for (const ground of GROUNDS[appearance]) {
        expect(contrastRatio(colors.primaryText, ground)).toBeGreaterThanOrEqual(4.5);
        // Edges, focus rings and solid fills are non-text: 3:1.
        expect(contrastRatio(colors.primaryEdge, ground)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(colors.primary, ground)).toBeGreaterThanOrEqual(3);
      }
    });
  });
});

describe("stockAccentVariables", () => {
  it("writes nothing for Iris so the stylesheet's literals apply", () => {
    expect(stockAccentVariables("iris")).toEqual({});
  });

  it("writes both appearances of the primary family for other accents", () => {
    const cobalt = STOCK_ACCENT_PALETTES.cobalt;
    expect(stockAccentVariables("cobalt")).toEqual({
      "--stock-primary": cobalt.light.primary,
      "--stock-primary-foreground": cobalt.light.primaryForeground,
      "--stock-primary-hover": cobalt.light.primaryHover,
      "--stock-primary-edge": cobalt.light.primaryEdge,
      "--stock-primary-text": cobalt.light.primaryText,
      "--stock-primary-dark": cobalt.dark.primary,
      "--stock-primary-foreground-dark": cobalt.dark.primaryForeground,
      "--stock-primary-hover-dark": cobalt.dark.primaryHover,
      "--stock-primary-edge-dark": cobalt.dark.primaryEdge,
      "--stock-primary-text-dark": cobalt.dark.primaryText,
      "--stock-terminal-selection": "rgb(13 71 161 / 18%)",
      "--stock-terminal-selection-dark": "rgb(99 135 246 / 22%)",
      "--stock-terminal-cursor-dark": cobalt.dark.primary,
    });
  });

  it("keeps every accent visibly apart from the info/update blue", () => {
    for (const accent of StockAccent.literals) {
      for (const [appearance, stock] of [
        ["light", E6_CODE_LIGHT_THEME_COLORS],
        ["dark", E6_CODE_DARK_THEME_COLORS],
      ] as const) {
        expect(
          colorDifference(STOCK_ACCENT_PALETTES[accent][appearance].primary, stock.update),
        ).toBeGreaterThanOrEqual(8);
      }
    }
  });
});

describe("isStockThemeActive", () => {
  it("is true only while the stock palette renders the appearance", () => {
    expect(isStockThemeActive("system", null, "light")).toBe(true);
    expect(isStockThemeActive("dark", null, "dark")).toBe(true);
    expect(isStockThemeActive("ocean", null, "light")).toBe(false);
    // A theme mix can put a library theme on just one half.
    expect(isStockThemeActive("system", { dark: "ocean" }, "light")).toBe(true);
    expect(isStockThemeActive("system", { dark: "ocean" }, "dark")).toBe(false);
  });
});
