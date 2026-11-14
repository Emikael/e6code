// @effect-diagnostics nodeBuiltinImport:off - reads index.css, which Vitest stubs on import.
import * as NodeFS from "node:fs";

import { DEFAULT_STOCK_ACCENT, StockAccent } from "@e6tools/contracts/settings";
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

// index.css washes the merged tone at 8% on Porcelain and 16% on Slate.
const MERGED_WASH_ALPHA = { light: 0.08, dark: 0.16 } as const;
// index.css --success, which no theme overrides.
const SUCCESS = { light: "#0f9f8c", dark: "#2dd4bf" } as const;

function mixHex(base: string, overlay: string, amount: number): string {
  const channels = [1, 3, 5].map((index) => {
    const from = Number.parseInt(base.slice(index, index + 2), 16);
    const to = Number.parseInt(overlay.slice(index, index + 2), 16);
    return Math.round(from + (to - from) * amount);
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

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
      expect(iris.merged).toBe(stock.merged);
      expect(iris.mergedForeground).toBe(stock.mergedForeground);
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
      // The merged wash is the merged tone over the canvas, as index.css mixes it.
      const mergedWash = mixHex(
        GROUNDS[appearance][0],
        colors.merged,
        MERGED_WASH_ALPHA[appearance],
      );
      for (const ground of [...GROUNDS[appearance], mergedWash]) {
        expect(contrastRatio(colors.mergedForeground, ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.merged, ground)).toBeGreaterThanOrEqual(3);
      }
    });

    it.each(["light", "dark"] as const)(
      "keeps merged apart from the accent, success and error in %s",
      (appearance) => {
        const colors = STOCK_ACCENT_PALETTES[accent][appearance];
        const stock =
          appearance === "dark" ? E6_CODE_DARK_THEME_COLORS : E6_CODE_LIGHT_THEME_COLORS;
        for (const other of [
          colors.primary,
          colors.primaryText,
          SUCCESS[appearance],
          stock.error,
        ]) {
          expect(colorDifference(colors.merged, other)).toBeGreaterThanOrEqual(15);
          expect(colorDifference(colors.mergedForeground, other)).toBeGreaterThanOrEqual(15);
        }
      },
    );
  });
});

const indexCss = NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8");

/** The fallback literal index.css gives a `var(--stock-…, literal)` token. */
function stylesheetFallback(variable: string): string | undefined {
  const escaped = variable.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`var\\(${escaped}, ([^;]+)\\);`).exec(indexCss)?.[1];
}

describe("stockAccentVariables", () => {
  it("writes nothing for the default accent so the stylesheet's literals apply", () => {
    expect(DEFAULT_STOCK_ACCENT).toBe("graphite");
    expect(stockAccentVariables(DEFAULT_STOCK_ACCENT)).toEqual({});
  });

  it("keeps the stylesheet's literals equal to the default accent", () => {
    // Every variable another accent writes has a literal in index.css; with
    // the default writing nothing, those literals are what a new profile sees.
    const iris = stockAccentVariables("iris");
    const graphite = STOCK_ACCENT_PALETTES[DEFAULT_STOCK_ACCENT];
    const expected: Record<string, string> = {
      "--stock-primary": graphite.light.primary,
      "--stock-primary-foreground": graphite.light.primaryForeground,
      "--stock-primary-hover": graphite.light.primaryHover,
      "--stock-primary-edge": graphite.light.primaryEdge,
      "--stock-primary-text": graphite.light.primaryText,
      "--stock-merged": graphite.light.merged,
      "--stock-merged-foreground": graphite.light.mergedForeground,
      "--stock-primary-dark": graphite.dark.primary,
      "--stock-primary-foreground-dark": graphite.dark.primaryForeground,
      "--stock-primary-hover-dark": graphite.dark.primaryHover,
      "--stock-primary-edge-dark": graphite.dark.primaryEdge,
      "--stock-primary-text-dark": graphite.dark.primaryText,
      "--stock-merged-dark": graphite.dark.merged,
      "--stock-merged-foreground-dark": graphite.dark.mergedForeground,
      "--stock-terminal-selection": "rgb(42 45 53 / 18%)",
      "--stock-terminal-selection-dark": "rgb(212 215 222 / 22%)",
      "--stock-terminal-cursor-dark": graphite.dark.primary,
    };
    expect(Object.keys(expected).toSorted()).toEqual(Object.keys(iris).toSorted());
    for (const [variable, value] of Object.entries(expected)) {
      expect(stylesheetFallback(variable), variable).toBe(value);
    }
  });

  it("writes Iris as overrides now that it is not the default", () => {
    const variables = stockAccentVariables("iris");
    expect(variables["--stock-primary"]).toBe(STOCK_ACCENT_PALETTES.iris.light.primary);
    expect(variables["--stock-primary-dark"]).toBe(STOCK_ACCENT_PALETTES.iris.dark.primary);
    expect(variables["--stock-terminal-selection"]).toBe("rgb(91 74 224 / 18%)");
  });

  it("writes both appearances of the primary family for other accents", () => {
    const cobalt = STOCK_ACCENT_PALETTES.cobalt;
    expect(stockAccentVariables("cobalt")).toEqual({
      "--stock-primary": cobalt.light.primary,
      "--stock-primary-foreground": cobalt.light.primaryForeground,
      "--stock-primary-hover": cobalt.light.primaryHover,
      "--stock-primary-edge": cobalt.light.primaryEdge,
      "--stock-primary-text": cobalt.light.primaryText,
      "--stock-merged": cobalt.light.merged,
      "--stock-merged-foreground": cobalt.light.mergedForeground,
      "--stock-primary-dark": cobalt.dark.primary,
      "--stock-primary-foreground-dark": cobalt.dark.primaryForeground,
      "--stock-primary-hover-dark": cobalt.dark.primaryHover,
      "--stock-primary-edge-dark": cobalt.dark.primaryEdge,
      "--stock-primary-text-dark": cobalt.dark.primaryText,
      "--stock-merged-dark": cobalt.dark.merged,
      "--stock-merged-foreground-dark": cobalt.dark.mergedForeground,
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
