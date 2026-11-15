import { BOOT_NEUTRAL } from "./bootNeutral.ts";

/**
 * Electron window colours. The main process picks them from the OS appearance only, before
 * any renderer setting is readable. Kept free of the theme data so the main bundle stays small.
 */
export const WINDOW_BACKGROUND_COLOR = {
  light: BOOT_NEUTRAL.light.background,
  dark: BOOT_NEUTRAL.dark.background,
} as const;

/** Windows Controls Overlay fill. `#00000000` does not work correctly on Linux. */
export const TITLEBAR_OVERLAY_COLOR = "#01000000";

export const TITLEBAR_SYMBOL_COLOR = { light: "#1f2937", dark: "#f8fafc" } as const;

/** The "Connecting to WSL" splash shown while the WSL backend boots. */
export const WSL_SPLASH_COLORS = {
  light: { label: "#6b7280", accent: "#1f2937", track: "rgba(31,41,55,0.18)" },
  dark: { label: "#9ca3af", accent: "#f8fafc", track: "rgba(248,250,252,0.18)" },
} as const;
