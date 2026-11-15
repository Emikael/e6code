/**
 * The neutral first frame: the boot splash when no theme is selected, and Electron's window
 * background before the renderer paints. Deliberately not the stock palette yet; E01-T11
 * points the first frame at the new ground.
 */
export const BOOT_NEUTRAL = {
  light: { background: "#ffffff", foreground: "#262626", accent: "#4f46e5" },
  dark: { background: "#0a0a0a", foreground: "#f5f5f5", accent: "#818cf8" },
} as const;
