import { htmlRenderTheme, type HtmlRenderTheme } from "@e6tools/shared/htmlRender";
import type { ThemeAppearance, ThemeColors } from "@e6tools/shared/themePalettes";
import { useMemo, useSyncExternalStore } from "react";

import {
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeDefinition,
  resolveThemeHalf,
  subscribeToCustomThemes,
  themeColorToHex,
} from "../themePalette";
import { useTheme } from "./useTheme";

function resolveActiveThemeColors(
  theme: string,
  halves: Parameters<typeof resolveThemeHalf>[1],
  appearance: ThemeAppearance,
): ThemeColors {
  const definition = getThemeDefinition(resolveThemeHalf(theme, halves, appearance));
  return definition === null
    ? getStandardThemeColors(appearance)
    : (getThemeColorsForMode(definition, appearance) ?? definition.colors);
}

/** The active theme as the variables an HTML artifact styles itself with. */
export function useHtmlRenderTheme(): HtmlRenderTheme {
  const { theme, resolvedTheme, themeHalves } = useTheme();
  // Custom palettes can be edited in place, under an unchanged preference.
  const colors = useSyncExternalStore(
    subscribeToCustomThemes,
    () => resolveActiveThemeColors(theme, themeHalves, resolvedTheme),
    () => getStandardThemeColors(resolvedTheme),
  );
  return useMemo(
    () =>
      htmlRenderTheme(
        Object.fromEntries(
          Object.entries(colors).map(([role, color]) => [role, themeColorToHex(color) ?? color]),
        ) as ThemeColors,
        resolvedTheme,
      ),
    [colors, resolvedTheme],
  );
}
