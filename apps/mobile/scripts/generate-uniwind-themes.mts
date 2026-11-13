#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import tailwindColors from "tailwindcss/colors";
import { DEFAULT_STOCK_ACCENT } from "@e6tools/contracts/settings";
import { BUILT_IN_THEME_IDS, type BuiltInThemeId } from "@e6tools/shared/themePalettes";

import {
  createMobileThemeVariables,
  getMobileThemeColors,
  getMobileThemeVariables,
  stockAccentVariables,
  DEFAULT_MOBILE_THEME_ID,
  type MobileThemeAppearance,
  type MobileThemeVariables,
} from "../src/lib/mobileTheme.ts";

const APPEARANCES = ["light", "dark"] as const;
const GENERATED_CSS_PATH = NodePath.resolve(import.meta.dirname, "../generated-uniwind-themes.css");
const GENERATED_NAMES_PATH = NodePath.resolve(
  import.meta.dirname,
  "../generated-uniwind-theme-names.json",
);
const GENERATED_DEFAULT_VARIABLES_PATH = NodePath.resolve(
  import.meta.dirname,
  "../generated-uniwind-default-theme-variables.json",
);
const GENERATED_CLERK_THEME_PATH = NodePath.resolve(import.meta.dirname, "../clerk-theme.json");
// Widget layouts are serialized into the extension without module scope, so
// they cannot import the palette. Their status colors are written into a
// marked block inside each widget function instead.
const WIDGET_SOURCE_PATHS = [
  NodePath.resolve(import.meta.dirname, "../src/widgets/AgentActivity.tsx"),
  NodePath.resolve(import.meta.dirname, "../src/widgets/SubscriptionUsage.tsx"),
];
const WIDGET_STATUS_COLORS_START = "  // <generated widget-status-colors>\n";
const WIDGET_STATUS_COLORS_END = "  // </generated widget-status-colors>\n";

type TailwindColorFamily = keyof typeof tailwindColors;
type TailwindColorShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

const color = (family: TailwindColorFamily, shade?: TailwindColorShade, opacity = 1): string => {
  const familyColors = tailwindColors[family];
  const value =
    typeof familyColors === "string"
      ? shade === undefined
        ? familyColors
        : undefined
      : shade === undefined
        ? undefined
        : familyColors[String(shade) as keyof typeof familyColors];
  if (value === undefined) {
    throw new Error(`Unknown Tailwind color ${family}${shade === undefined ? "" : `-${shade}`}.`);
  }
  if (opacity === 1) return value;

  const percentage = Number((opacity * 100).toFixed(4));
  const oklch = /^oklch\((.*)\)$/.exec(value);
  if (oklch) return `oklch(${oklch[1]} / ${percentage}%)`;
  if (value === "#fff") return `rgb(255 255 255 / ${percentage}%)`;
  if (value === "#000") return `rgb(0 0 0 / ${percentage}%)`;
  return `color-mix(in srgb, ${value} ${percentage}%, transparent)`;
};

// These replace the remaining dark:* utility pairs. A registered palette theme is
// neither literally `light` nor `dark`, so appearance-sensitive values must also be
// represented as semantic variables for custom themes.
const ADAPTIVE_COLORS: Readonly<Record<string, readonly [light: string, dark: string]>> = {
  "--color-adaptive-amber-50-950-a40": [color("amber", 50), color("amber", 950, 0.4)],
  "--color-adaptive-amber-200-900-a60": [color("amber", 200), color("amber", 900, 0.6)],
  "--color-adaptive-amber-500-a12-a16": [color("amber", 500, 0.12), color("amber", 500, 0.16)],
  "--color-adaptive-amber-700-300": [color("amber", 700), color("amber", 300)],
  "--color-adaptive-amber-700-400": [color("amber", 700), color("amber", 400)],
  "--color-adaptive-amber-800-200": [color("amber", 800), color("amber", 200)],
  "--color-adaptive-blue-50-blue-400-a14": [color("blue", 50), color("blue", 400, 0.14)],
  "--color-adaptive-blue-300-a50-blue-400-a28": [color("blue", 300, 0.5), color("blue", 400, 0.28)],
  "--color-adaptive-blue-500-a20-blue-400-a15": [color("blue", 500, 0.2), color("blue", 400, 0.15)],
  "--color-adaptive-blue-500-400": [color("blue", 500), color("blue", 400)],
  "--color-adaptive-blue-600-400": [color("blue", 600), color("blue", 400)],
  "--color-adaptive-black-a10-a25": [
    color("black", undefined, 0.1),
    color("black", undefined, 0.25),
  ],
  "--color-adaptive-black-a15-a35": [
    color("black", undefined, 0.15),
    color("black", undefined, 0.35),
  ],
  "--color-adaptive-indigo-700-300": [color("indigo", 700), color("indigo", 300)],
  "--color-adaptive-neutral-100-900": [color("neutral", 100), color("neutral", 900)],
  "--color-adaptive-neutral-200-700-a60": [color("neutral", 200), color("neutral", 700, 0.6)],
  "--color-adaptive-neutral-200-800": [color("neutral", 200), color("neutral", 800)],
  "--color-adaptive-neutral-200-a70-white-a8": [
    color("neutral", 200, 0.7),
    color("white", undefined, 0.08),
  ],
  "--color-adaptive-neutral-200-white-a6": [color("neutral", 200), color("white", undefined, 0.06)],
  "--color-adaptive-neutral-200-white-a8": [color("neutral", 200), color("white", undefined, 0.08)],
  "--color-adaptive-neutral-200-a80-white-a8": [
    color("neutral", 200, 0.8),
    color("white", undefined, 0.08),
  ],
  "--color-adaptive-neutral-300-a60-white-a12": [
    color("neutral", 300, 0.6),
    color("white", undefined, 0.12),
  ],
  "--color-adaptive-neutral-400-500": [color("neutral", 400), color("neutral", 500)],
  "--color-adaptive-neutral-400-a60-500-a60": [
    color("neutral", 400, 0.6),
    color("neutral", 500, 0.6),
  ],
  "--color-adaptive-neutral-400-a80-500-a80": [
    color("neutral", 400, 0.8),
    color("neutral", 500, 0.8),
  ],
  "--color-adaptive-neutral-500-a10-a16": [color("neutral", 500, 0.1), color("neutral", 500, 0.16)],
  "--color-adaptive-neutral-500-400": [color("neutral", 500), color("neutral", 400)],
  "--color-adaptive-neutral-500-500": [color("neutral", 500), color("neutral", 500)],
  "--color-adaptive-neutral-600-300": [color("neutral", 600), color("neutral", 300)],
  "--color-adaptive-neutral-600-400": [color("neutral", 600), color("neutral", 400)],
  "--color-adaptive-neutral-950-50": [color("neutral", 950), color("neutral", 50)],
  "--color-adaptive-red-50-950-a80": [color("red", 50), color("red", 950, 0.8)],
  "--color-adaptive-red-200-800": [color("red", 200), color("red", 800)],
  "--color-adaptive-red-600-a80-400-a80": [color("red", 600, 0.8), color("red", 400, 0.8)],
  "--color-adaptive-red-700-300": [color("red", 700), color("red", 300)],
  "--color-adaptive-rose-100-500-a18": [color("rose", 100), color("rose", 500, 0.18)],
  "--color-adaptive-rose-100-a80-500-a12": [color("rose", 100, 0.8), color("rose", 500, 0.12)],
  "--color-adaptive-rose-300-a70-400-a28": [color("rose", 300, 0.7), color("rose", 400, 0.28)],
  "--color-adaptive-rose-500-a12-a16": [color("rose", 500, 0.12), color("rose", 500, 0.16)],
  "--color-adaptive-rose-500-400": [color("rose", 500), color("rose", 400)],
  "--color-adaptive-white-neutral-950-a70": [color("white"), color("neutral", 950, 0.7)],
  "--color-adaptive-zinc-500-a12-a16": [color("zinc", 500, 0.12), color("zinc", 500, 0.16)],
  "--color-adaptive-zinc-500-400": [color("zinc", 500), color("zinc", 400)],
  "--color-adaptive-zinc-600-300": [color("zinc", 600), color("zinc", 300)],
};

export const customThemeNames = BUILT_IN_THEME_IDS.flatMap((themeId) =>
  APPEARANCES.map((appearance) => `${themeId}-${appearance}`),
);

const adaptiveVariablesFor = (appearance: MobileThemeAppearance) =>
  Object.fromEntries(
    Object.entries(ADAPTIVE_COLORS).map(([name, [light, dark]]) => [
      name,
      appearance === "light" ? light : dark,
    ]),
  );

const variablesFor = (themeId: BuiltInThemeId, appearance: MobileThemeAppearance) => ({
  ...getMobileThemeVariables(themeId, appearance),
  ...adaptiveVariablesFor(appearance),
  ...clerkVariablesFor(appearance),
});

// Clerk's native screens use one build-time palette per appearance. Custom
// profile pages must match it even when the rest of the app uses a named theme.
const clerkColorsFor = (appearance: MobileThemeAppearance) => {
  // Native authentication uses plain cards, rather than tonal settings groups,
  // in the default accent the rest of the app starts with.
  const variables = {
    ...createMobileThemeVariables(
      getMobileThemeColors(DEFAULT_MOBILE_THEME_ID, appearance),
      appearance,
    ),
    ...stockAccentVariables(DEFAULT_STOCK_ACCENT, appearance),
  };
  return {
    primary: variables["--color-primary"],
    background: variables["--color-sheet-solid"],
    input: variables["--color-input"],
    danger: variables["--color-danger-foreground"],
    success: appearance === "dark" ? "#34d399" : "#059669",
    warning: variables["--color-warning-foreground"],
    foreground: variables["--color-foreground"],
    mutedForeground: variables["--color-foreground-muted"],
    primaryForeground: variables["--color-primary-foreground"],
    inputForeground: variables["--color-foreground"],
    neutral: variables["--color-secondary"],
    border: variables["--color-border"],
    ring: variables["--color-focus"],
    muted: variables["--color-subtle"],
    shadow: variables["--color-primary-shadow"],
  };
};

const clerkVariablesFor = (appearance: MobileThemeAppearance) => {
  const colors = clerkColorsFor(appearance);
  return {
    "--color-clerk-page": colors.background.toLowerCase(),
    "--color-clerk-foreground": colors.foreground.toLowerCase(),
    "--color-clerk-foreground-muted": colors.mutedForeground.toLowerCase(),
    "--color-clerk-border": colors.border,
    "--color-clerk-danger": colors.danger.toLowerCase(),
  };
};

const renderVariant = (name: string, variables: Readonly<Record<string, string>>) => {
  const declarations = Object.entries(variables)
    .map(([variable, value]) => `      ${variable}: ${value};`)
    .join("\n");
  return `    @variant ${name} {\n${declarations}\n    }`;
};

export const renderUniwindThemesCSS = () => {
  const variants = [
    ...APPEARANCES.map((appearance) =>
      renderVariant(appearance, {
        ...getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance),
        ...adaptiveVariablesFor(appearance),
        ...clerkVariablesFor(appearance),
      }),
    ),
    ...BUILT_IN_THEME_IDS.flatMap((themeId) =>
      APPEARANCES.map((appearance) =>
        renderVariant(`${themeId}-${appearance}`, variablesFor(themeId, appearance)),
      ),
    ),
  ];
  return [
    "/* Generated by scripts/generate-uniwind-themes.mts. Do not edit manually. */",
    "@layer theme {",
    "  :root {",
    variants.join("\n\n"),
    "  }",
    "}",
    "",
  ].join("\n");
};

/**
 * The stock palette's status text roles for widgets, which render on the
 * system's light or dark material rather than an app theme.
 */
const widgetStatusColorsFor = (appearance: MobileThemeAppearance) => {
  const variables = getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance);
  return {
    primary: variables["--color-primary-text"],
    warning: variables["--color-warning-foreground"],
    update: variables["--color-update-foreground"],
    success: variables["--color-success-foreground"],
    error: variables["--color-danger-foreground"],
  };
};

const renderWidgetStatusColors = () => {
  const lines = [
    WIDGET_STATUS_COLORS_START.trimEnd(),
    "  // Written by scripts/generate-uniwind-themes.mts from the stock palette.",
    "  const statusColors = {",
    ...APPEARANCES.flatMap((appearance) => [
      `    ${appearance}: {`,
      ...Object.entries(widgetStatusColorsFor(appearance)).map(
        ([role, value]) => `      ${role}: "${value}",`,
      ),
      "    },",
    ]),
    "  } as const;",
    WIDGET_STATUS_COLORS_END.trimEnd(),
  ];
  return `${lines.join("\n")}\n`;
};

/** Replace the block between `start` and `end` (both kept) in a hand-written file. */
const replaceGeneratedBlock = (filename: string, start: string, end: string, block: string) => {
  const source = NodeFS.readFileSync(filename, "utf8");
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `${filename} has no generated block between ${start.trim()} and ${end.trim()}.`,
    );
  }
  return source.slice(0, startIndex) + block + source.slice(endIndex + end.length);
};

const renderWidgetSource = (filename: string) =>
  replaceGeneratedBlock(
    filename,
    WIDGET_STATUS_COLORS_START,
    WIDGET_STATUS_COLORS_END,
    renderWidgetStatusColors(),
  );

// Android widgets and notifications read colour resources. Each file keeps
// its hand-written frame; the generator owns the colours between the markers
// in the default (light) and values-night (dark) resource directories.
const ANDROID_COLORS_START = "<!-- <generated android-colors> -->\n";
const ANDROID_COLORS_END = "<!-- </generated android-colors> -->\n";

const ANDROID_COLOR_RESOURCE_SOURCES = [
  {
    resDir: "../modules/e6-agent-notifications/android/src/main/res",
    file: "agent_activity_colors.xml",
    indent: "    ",
    // Phase tints match the iOS Live Activity and the web sidebar's status line.
    colors: (variables: MobileThemeVariables) => ({
      agent_activity_working: variables["--color-primary-text"],
      agent_activity_attention: variables["--color-warning-foreground"],
      agent_activity_input: variables["--color-update-foreground"],
      agent_activity_waiting: variables["--color-foreground-muted"],
      agent_activity_done: variables["--color-success-foreground"],
      agent_activity_failed: variables["--color-danger-foreground"],
    }),
  },
  {
    resDir: "../modules/e6-subscription-widget/android/src/main/res",
    file: "colors.xml",
    indent: "  ",
    colors: (variables: MobileThemeVariables) => ({
      e6_widget_background: variables["--color-screen"],
      e6_widget_foreground: variables["--color-foreground"],
      e6_widget_secondary: variables["--color-foreground-muted"],
    }),
  },
] as const;

const renderAndroidColorResources = () =>
  ANDROID_COLOR_RESOURCE_SOURCES.flatMap(({ resDir, file, indent, colors }) =>
    APPEARANCES.map((appearance) => {
      const filename = NodePath.resolve(
        import.meta.dirname,
        resDir,
        appearance === "light" ? "values" : "values-night",
        file,
      );
      const start = `${indent}${ANDROID_COLORS_START}`;
      const end = `${indent}${ANDROID_COLORS_END}`;
      const entries = Object.entries(
        colors(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance)),
      ).map(([name, value]) => `${indent}<color name="${name}">${value}</color>\n`);
      return [
        filename,
        replaceGeneratedBlock(filename, start, end, [start, ...entries, end].join("")),
      ] as const;
    }),
  );

export const renderDefaultThemeVariablesJSON = () =>
  `${JSON.stringify(
    Object.fromEntries(
      APPEARANCES.map((appearance) => [
        appearance,
        getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance),
      ]),
    ),
    null,
    2,
  )}\n`;

export const getGeneratedUniwindThemeOutputs = (): ReadonlyArray<
  readonly [filename: string, contents: string]
> => [
  [GENERATED_CSS_PATH, renderUniwindThemesCSS()],
  [GENERATED_NAMES_PATH, `${JSON.stringify(customThemeNames, null, 2)}\n`],
  [GENERATED_DEFAULT_VARIABLES_PATH, renderDefaultThemeVariablesJSON()],
  [
    GENERATED_CLERK_THEME_PATH,
    `${JSON.stringify({ colors: clerkColorsFor("light"), darkColors: clerkColorsFor("dark"), design: { borderRadius: 18 } }, null, 2)}\n`,
  ],
  ...WIDGET_SOURCE_PATHS.map((filename) => [filename, renderWidgetSource(filename)] as const),
  ...renderAndroidColorResources(),
];

const writeFileAtomically = (filename: string, contents: string) => {
  const current = NodeFS.existsSync(filename) ? NodeFS.readFileSync(filename, "utf8") : null;
  if (current === contents) return;

  const temporaryFilename = `${filename}.${process.pid}.tmp`;
  try {
    NodeFS.writeFileSync(temporaryFilename, contents);
    NodeFS.renameSync(temporaryFilename, filename);
  } finally {
    if (NodeFS.existsSync(temporaryFilename)) NodeFS.unlinkSync(temporaryFilename);
  }
};

if (import.meta.main) {
  const checkOnly = process.argv.includes("--check");
  for (const [filename, contents] of getGeneratedUniwindThemeOutputs()) {
    if (checkOnly) {
      const current = NodeFS.existsSync(filename) ? NodeFS.readFileSync(filename, "utf8") : null;
      if (current !== contents) {
        console.error(
          `${NodePath.relative(process.cwd(), filename)} is stale. Run vp run --filter @e6tools/mobile generate.`,
        );
        process.exitCode = 1;
      }
      continue;
    }
    // Metro watches the generated CSS. Replacing a complete temporary file keeps
    // Tailwind from compiling a partially rewritten theme file.
    writeFileAtomically(filename, contents);
  }
}
