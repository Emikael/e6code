import { BOOT_NEUTRAL } from "./bootNeutral.ts";
import {
  BUILT_IN_THEMES,
  E6_CHAT_THEME,
  RESERVED_THEME_IDS,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeDefinition,
} from "./themePalettes.ts";
import { renderCssRule } from "./webStock.ts";

/**
 * The palette data of the boot script and boot styles in `apps/web/index.html`. The web Vite
 * plugin renders these into the file's `@design-tokens` placeholders; the resolution logic
 * around them stays hand-written in `index.html`.
 */

export { BOOT_NEUTRAL };

/** Static `<meta name="theme-color">` before the boot script overwrites it. */
export const BOOT_THEME_COLOR = BOOT_NEUTRAL.dark.background;

type BootThemePalette = Readonly<{
  background: string;
  foreground: string;
  accent: string;
  chrome: string;
}>;

const APPEARANCES: ReadonlyArray<ThemeAppearance> = ["light", "dark"];

function bootThemePalettes(theme: ThemeDefinition) {
  const palettes: Partial<Record<ThemeAppearance, BootThemePalette>> = {};
  for (const appearance of APPEARANCES) {
    const colors = getThemeColorsForAppearance(theme, appearance);
    if (colors) {
      palettes[appearance] = {
        background: colors.canvas,
        foreground: colors.text,
        accent: colors.accent,
        chrome: colors.chrome,
      };
    }
  }
  return palettes;
}

type JsLiteral = string | ReadonlyArray<JsLiteral> | { readonly [key: string]: JsLiteral };

/** Formats a literal the way `vp fmt` lays out the hand-written boot script: one entry per line. */
function renderJs(value: JsLiteral, indent: string): string {
  if (typeof value === "string") return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${renderJs(item, inner)},\n`).join("")}${indent}]`;
  }
  const entries = Object.entries(value as { readonly [key: string]: JsLiteral }).map(
    ([key, item]) =>
      `${inner}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${renderJs(item, inner)},\n`,
  );
  return `{\n${entries.join("")}${indent}}`;
}

const renderConst = (name: string, value: JsLiteral, indent: string) =>
  `${indent}const ${name} = ${renderJs(value, indent)};`;

const renderComment = (lines: ReadonlyArray<string>, indent: string) =>
  lines.map((line) => `${indent}// ${line}`).join("\n");

/** Boot-script placeholders, by name, rendered at the placeholder's indentation. */
export const BOOT_SCRIPT_BLOCKS: Readonly<Record<string, (indent: string) => string>> = {
  "boot-backgrounds": (indent) =>
    [
      renderConst("LIGHT_BACKGROUND", BOOT_NEUTRAL.light.background, indent),
      renderConst("DARK_BACKGROUND", BOOT_NEUTRAL.dark.background, indent),
    ].join("\n"),
  "boot-palette": (indent) =>
    [
      renderConst("SPLASH_COLORS", BOOT_NEUTRAL, indent),
      renderComment(
        [
          "These are the runtime defaults used to complete a custom palette",
          "when a stored theme omits a role. Keep them separate from the",
          "unselected splash so a partial custom theme does not flash generic",
          "app colors before React mounts.",
        ],
        indent,
      ),
      renderConst("DEFAULT_THEME_PALETTES", bootThemePalettes(E6_CHAT_THEME), indent),
      renderComment(
        [
          "Keep this small boot-time copy in sync with the built-in palettes so",
          "the selected theme is visible before the app has mounted.",
        ],
        indent,
      ),
      renderConst(
        "BUILT_IN_THEME_PALETTES",
        Object.fromEntries(BUILT_IN_THEMES.map((theme) => [theme.id, bootThemePalettes(theme)])),
        indent,
      ),
    ].join("\n"),
  "boot-reserved-theme-ids": (indent) =>
    renderConst("RESERVED_THEME_IDS", [...RESERVED_THEME_IDS], indent),
};

/** The `body` colours of the boot shell before React mounts. */
export function renderBootStyle(indent: string): string {
  return [
    renderCssRule(
      {
        rule: "body",
        body: [
          ["background", BOOT_NEUTRAL.light.background],
          ["color", BOOT_NEUTRAL.light.foreground],
          ["font-family", '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'],
        ],
      },
      indent,
    ),
    "",
    renderCssRule(
      {
        rule: "html.dark body",
        body: [
          ["background", BOOT_NEUTRAL.dark.background],
          ["color", BOOT_NEUTRAL.dark.foreground],
        ],
      },
      indent,
    ),
  ].join("\n");
}
