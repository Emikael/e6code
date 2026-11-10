import type { DesktopPreviewAnnotationTheme } from "@e6tools/contracts";

import { DEFAULT_CODE_FONT_STACK, DEFAULT_SANS_FONT_STACK } from "../appearanceFonts";

const readVariable = (styles: CSSStyleDeclaration, name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback;

export function readPreviewAnnotationTheme(): DesktopPreviewAnnotationTheme {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  return {
    colorScheme: root.classList.contains("dark") ? "dark" : "light",
    radius: readVariable(styles, "--radius", "0.625rem"),
    background: readVariable(styles, "--background", "white"),
    foreground: readVariable(styles, "--contrast-foreground", "oklch(0.269 0 0)"),
    popover: readVariable(styles, "--popover", "white"),
    popoverForeground: readVariable(styles, "--contrast-popover-foreground", "oklch(0.269 0 0)"),
    primary: readVariable(styles, "--primary", "#5b4ae0"),
    primaryForeground: readVariable(styles, "--primary-foreground", "#ffffff"),
    primaryText: readVariable(styles, "--primary-text", "#4a3ad0"),
    muted: readVariable(styles, "--muted", "rgb(0 0 0 / 4%)"),
    mutedForeground: readVariable(styles, "--contrast-muted-foreground", "oklch(0.556 0 0)"),
    accent: readVariable(styles, "--accent", "rgb(0 0 0 / 4%)"),
    accentForeground: readVariable(styles, "--contrast-accent-foreground", "oklch(0.269 0 0)"),
    border: readVariable(styles, "--contrast-border", "rgb(0 0 0 / 8%)"),
    input: readVariable(styles, "--contrast-input", "rgb(0 0 0 / 10%)"),
    ring: readVariable(styles, "--ring", "#5b4ae0"),
    fontSans: readVariable(styles, "--font-sans", styles.fontFamily || DEFAULT_SANS_FONT_STACK),
    fontMono: readVariable(styles, "--font-mono", DEFAULT_CODE_FONT_STACK),
  };
}
