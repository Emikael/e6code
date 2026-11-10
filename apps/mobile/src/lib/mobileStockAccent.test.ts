import { StockAccent } from "@e6tools/contracts/settings";
import { STOCK_ACCENT_PALETTES } from "@e6tools/shared/themePalettes";
import { describe, expect, it } from "vite-plus/test";

import { getStockAccentTerminalCursor, getStockAccentVariableOverrides } from "./mobileStockAccent";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";
import { DEFAULT_MOBILE_THEME_ID, MOBILE_THEME_VARIABLE_NAMES } from "./mobileTheme";

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const APPEARANCES = ["light", "dark"] as const;

describe("getStockAccentVariableOverrides", () => {
  it("leaves Iris and every other theme exactly as generated", () => {
    for (const appearance of APPEARANCES) {
      expect(getStockAccentVariableOverrides(DEFAULT_MOBILE_THEME_ID, "iris", appearance)).toEqual(
        {},
      );
      expect(getStockAccentVariableOverrides("ocean", "rose", appearance)).toEqual({});
      // Material You brings the system accent.
      expect(getStockAccentVariableOverrides("material-you", "rose", appearance)).toEqual({});
    }
  });

  it.each(APPEARANCES)(
    "generates the stock palette with Iris's shared values in %s",
    (appearance) => {
      // Text and links must not shift when another accent is picked and back, and must match web.
      const iris = STOCK_ACCENT_PALETTES.iris[appearance];
      for (const platform of ["ios", "android"]) {
        const variables = getMobileThemeRuntimeVariables(
          DEFAULT_MOBILE_THEME_ID,
          appearance,
          platform,
        );
        expect(variables).toMatchObject({
          "--color-primary": iris.primary,
          "--color-primary-foreground": iris.primaryForeground,
          "--color-primary-text": iris.primaryText,
          "--color-primary-edge": iris.primaryEdge,
          "--color-md-link": iris.primaryText,
          "--color-user-bubble-skill-foreground": iris.primaryText,
          "--color-merged-foreground": iris.mergedForeground,
        });
      }
    },
  );

  it("replaces only the primary and merged families on the stock palette", () => {
    const overrides = getStockAccentVariableOverrides(DEFAULT_MOBILE_THEME_ID, "cobalt", "light");
    const cobalt = STOCK_ACCENT_PALETTES.cobalt.light;
    expect(overrides).toEqual({
      "--color-primary": cobalt.primary,
      "--color-primary-foreground": cobalt.primaryForeground,
      "--color-primary-text": cobalt.primaryText,
      "--color-primary-edge": cobalt.primaryEdge,
      "--color-focus": cobalt.primary,
      "--color-switch-active-track": cobalt.primary,
      "--color-switch-active-thumb": cobalt.primaryForeground,
      "--color-md-link": cobalt.primaryText,
      "--color-user-bubble-skill-foreground": cobalt.primaryText,
      "--color-inline-skill-border": "rgba(13, 71, 161, 0.42)",
      "--color-inline-skill-background": "#ecf0f7",
      "--color-merged": "#faeefb",
      "--color-merged-foreground": cobalt.mergedForeground,
    });
    for (const name of Object.keys(overrides)) {
      expect(MOBILE_THEME_VARIABLE_NAMES).toContain(name);
    }
  });

  describe.each(StockAccent.literals)("%s", (accent) => {
    it.each(APPEARANCES)("keeps accent text readable on mobile surfaces in %s", (appearance) => {
      for (const platform of ["ios", "android"]) {
        const variables = {
          ...getMobileThemeRuntimeVariables(DEFAULT_MOBILE_THEME_ID, appearance, platform),
          ...getStockAccentVariableOverrides(DEFAULT_MOBILE_THEME_ID, accent, appearance),
        };
        const text = variables["--color-primary-text"];
        for (const surface of [
          variables["--color-screen"],
          variables["--color-card"],
          variables["--color-grouped-card"],
          variables["--color-card-alt"],
        ]) {
          expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
        }
        for (const surface of [
          variables["--color-merged"],
          variables["--color-screen"],
          variables["--color-card"],
          variables["--color-grouped-card"],
          variables["--color-card-alt"],
        ]) {
          expect(
            contrastRatio(variables["--color-merged-foreground"], surface),
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          contrastRatio(
            variables["--color-user-bubble-skill-foreground"],
            variables["--color-user-bubble"],
          ),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(variables["--color-primary-foreground"], variables["--color-primary"]),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(
            variables["--color-inline-skill-foreground"],
            variables["--color-inline-skill-background"],
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});

describe("getStockAccentTerminalCursor", () => {
  it("moves only Slate's stock cursor to the accent", () => {
    expect(getStockAccentTerminalCursor(DEFAULT_MOBILE_THEME_ID, "rose", "dark")).toBe(
      STOCK_ACCENT_PALETTES.rose.dark.primary,
    );
    expect(getStockAccentTerminalCursor(DEFAULT_MOBILE_THEME_ID, "rose", "light")).toBeNull();
    expect(getStockAccentTerminalCursor(DEFAULT_MOBILE_THEME_ID, "iris", "dark")).toBeNull();
    expect(getStockAccentTerminalCursor("ocean", "rose", "dark")).toBeNull();
  });
});
