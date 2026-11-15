/**
 * The stock web tokens: the blocks of `apps/web/src/index.css` that hold values rather than
 * role names. The web Vite plugin (`apps/web/vite/designTokens.ts`) renders each block into
 * its `@design-tokens` placeholder before Tailwind compiles the file, so the cascade order
 * and Tailwind functions (`--alpha()`, `@variant`) work exactly as hand-written CSS.
 *
 * Values are verbatim CSS strings. Nothing here parses or normalises colours.
 */

export type CssRule = { readonly rule: string; readonly body: ReadonlyArray<CssNode> };
export type CssNode =
  | readonly [property: string, value: string]
  | { readonly comment: string }
  | CssRule;

/** `:root` geometry, glass, scrollbar and contrast-boost tokens. */
export const STOCK_GEOMETRY: CssRule = {
  rule: ":root",
  body: [
    ["--app-scrollbar-width", "6px"],
    ["--appearance-contrast-base", "100%"],
    ["--appearance-contrast-boost", "0%"],
    ["--appearance-contrast-border-boost", "0%"],
    ["--appearance-contrast-target", "black"],
    ["--app-scrollbar-thumb", "rgb(217 217 217)"],
    ["--app-scrollbar-thumb-hover", "rgb(191 191 191)"],
    {
      comment:
        "Compact UI geometry. Keep these values semantic so sidebar, palette,\ntooltip, and toolbar controls cannot quietly drift apart.",
    },
    ["--control-radius", "0.5rem"],
    ["--sidebar-content-inset", "0.5rem"],
    ["--sidebar-control-gap", "0.5rem"],
    [
      "--sidebar-icon-color",
      "color-mix(in srgb, var(--contrast-sidebar-muted-foreground) 85%, var(--sidebar))",
    ],
    ["--sidebar-row-content-inset", "0.625rem"],
    ["--command-shell-inset", "0.5rem"],
    ["--command-content-inset", "1rem"],
    ["--floating-content-inset", "0.75rem"],
    ["--glass-blur", "12px"],
    ["--glass-opacity", "80%"],
    ["--glass-saturation", "1.14"],
    ["--desktop-window-right-resize-inset", "0px"],
    ["--workspace-topbar-height", "56px"],
    ["--workspace-controls-top", "0px"],
    ["--workspace-controls-left", "calc(env(safe-area-inset-left) + 0.75rem)"],
    ["--workspace-controls-right", "calc(env(safe-area-inset-right) + 0.75rem)"],
    ["--workspace-native-controls-inset", "0px"],
    ["--workspace-titlebar-control-size", "1.75rem"],
    ["--workspace-titlebar-control-gap", "0.75rem"],
    ["--workspace-titlebar-scroll-fade-height", "1.5rem"],
    {
      rule: "@variant dark",
      body: [
        ["--appearance-contrast-target", "white"],
        ["--app-scrollbar-thumb", "rgb(255 255 255 / 8%)"],
        ["--app-scrollbar-thumb-hover", "rgb(255 255 255 / 12%)"],
        ["--glass-blur", "16px"],
        ["--glass-saturation", "1.08"],
      ],
    },
  ],
};

/** The stock palette: Porcelain on `:root`, Slate under `@variant dark`. */
export const STOCK_PALETTE: CssRule = {
  rule: ":root",
  body: [
    ["color-scheme", "light"],
    ["--radius", "0.5rem"],
    { comment: "Porcelain: white content over cool slate-tinted chrome." },
    ["--background", "#ffffff"],
    {
      comment:
        "Floating panels: the sidebar and the content are separate panels on a\nslate-tinted window ground, a panel gap apart.",
    },
    ["--app-window-background", "#eef0f4"],
    ["--panel-gap", "0.5rem"],
    ["--radius-panel", "14px"],
    ["--floating-controls-top", "0px"],
    ["--floating-controls-left", "0px"],
    {
      rule: "@media (width >= 48rem)",
      body: [
        ["--floating-controls-top", "calc(var(--panel-gap) + 1px)"],
        ["--floating-controls-left", "calc(var(--panel-gap) + 1px)"],
      ],
    },
    ["--app-chrome-background", "var(--background)"],
    ["--toolbar-background", "var(--app-chrome-background)"],
    ["--toolbar-foreground", "var(--foreground)"],
    ["--toolbar-border", "var(--border)"],
    ["--toolbar-control", "var(--popover)"],
    ["--toolbar-control-foreground", "var(--foreground)"],
    ["--toolbar-control-hover", "var(--accent)"],
    ["--surface-well", "#eceef2"],
    ["--surface-raised", "#f8f9fb"],
    ["--surface-floating", "var(--popover)"],
    ["--bezel-highlight", "rgb(255 255 255 / 72%)"],
    ["--bezel-border", "color-mix(in srgb, var(--foreground) 8%, transparent)"],
    [
      "--command-deck-shadow",
      "0 16px 36px -14px rgb(20 22 27 / 16%), 0 2px 6px -1px rgb(20 22 27 / 5%)",
    ],
    ["--foreground", "#14161b"],
    ["--card", "#ffffff"],
    ["--card-foreground", "var(--foreground)"],
    ["--popover", "#ffffff"],
    ["--popover-foreground", "var(--foreground)"],
    {
      comment:
        "Iris is the one accent: the next action and a working agent. It carries\nwhite ink on Porcelain, a darker edge and text variant, and a translucent\nwash for selections and the Working pill. The Accent setting swaps the\nfamily through the --stock-primary* variables (stockAccent.ts); the\nliterals are Iris.",
    },
    ["--primary", "var(--stock-primary, #5b4ae0)"],
    ["--primary-foreground", "var(--stock-primary-foreground, #ffffff)"],
    ["--primary-hover", "var(--stock-primary-hover, #4c3bd1)"],
    ["--primary-edge", "var(--stock-primary-edge, #4a3ad0)"],
    ["--primary-text", "var(--stock-primary-text, #4a3ad0)"],
    ["--primary-surface", "color-mix(in srgb, var(--primary) 8%, transparent)"],
    ["--secondary", "#eceef2"],
    ["--secondary-foreground", "#2a2d35"],
    ["--muted", "#f1f3f6"],
    ["--muted-foreground", "#5a606d"],
    ["--placeholder", "#6b7180"],
    ["--secondary-label", "var(--muted-foreground)"],
    ["--icon-muted", "var(--muted-foreground)"],
    ["--message-surface", "#eceef2"],
    ["--message-foreground", "var(--foreground)"],
    ["--message-action", "var(--primary)"],
    ["--message-action-foreground", "var(--primary-foreground)"],
    ["--message-action-hover", "var(--primary-hover)"],
    ["--accent", "#eef0f4"],
    ["--accent-foreground", "var(--foreground)"],
    ["--error", "#dc2626"],
    ["--error-foreground", "#b42318"],
    ["--tool-error-icon", "var(--error)"],
    ["--error-surface", "color-mix(in srgb, var(--error) 8%, transparent)"],
    ["--destructive", "var(--error)"],
    ["--border", "#e3e5ea"],
    ["--input", "#cdd1d9"],
    ["--ring", "var(--primary)"],
    ["--destructive-foreground", "var(--error-foreground)"],
    ["--info", "#2563eb"],
    ["--info-foreground", "#1d4ed8"],
    ["--success", "#0f9f8c"],
    ["--success-foreground", "#096b5f"],
    ["--warning", "#d97706"],
    ["--warning-foreground", "#92400e"],
    ["--warning-surface", "color-mix(in srgb, var(--warning) 8%, transparent)"],
    ["--update", "var(--info)"],
    ["--update-foreground", "var(--info-foreground)"],
    ["--update-surface", "color-mix(in srgb, var(--update) 12%, transparent)"],
    {
      comment:
        "Merged pull requests pair with the accent (STOCK_ACCENT_PALETTES in\nthemePalettes.ts) so they never share the primary's hue; the literals\nare Iris's fuchsia.",
    },
    ["--merged", "var(--stock-merged, #c026d3)"],
    ["--merged-foreground", "var(--stock-merged-foreground, #a21caf)"],
    ["--merged-surface", "color-mix(in srgb, var(--merged) 8%, transparent)"],
    {
      comment:
        "Keep every sidebar primitive on the same light surface hierarchy, including\nportaled mobile sheets and settings navigation outside the app sidebar.",
    },
    ["--sidebar", "#f8f9fb"],
    ["--sidebar-foreground", "var(--foreground)"],
    ["--sidebar-muted-foreground", "#5a606d"],
    ["--sidebar-control-surface", "#eceef2"],
    ["--sidebar-row-hover", "#eceef2"],
    ["--sidebar-row-active", "#ffffff"],
    ["--sidebar-row-selected", "#ffffff"],
    ["--sidebar-border", "var(--border)"],
    ["--sidebar-stage-fade", "var(--sidebar)"],
    ["--code-background", "color-mix(in srgb, var(--card) 90%, var(--background))"],
    ["--code-foreground", "var(--foreground)"],
    ["--terminal-background", "var(--background)"],
    ["--terminal-foreground", "var(--foreground)"],
    ["--terminal-cursor", "#14161b"],
    ["--terminal-selection-background", "var(--stock-terminal-selection, rgb(91 74 224 / 18%))"],
    {
      rule: "@variant dark",
      body: [
        ["color-scheme", "dark"],
        {
          comment:
            "Slate: cool blue-grey surfaces. The sidebar sits one step darker than\nthe thread, cards and overlays step lighter, and borders and hover\nstates provide separation without milky fills.",
        },
        ["--background", "#1a1d23"],
        ["--app-window-background", "#0c0d10"],
        ["--surface-well", "#0f1114"],
        ["--surface-raised", "#13151a"],
        ["--surface-floating", "#22252c"],
        ["--bezel-highlight", "rgb(255 255 255 / 5%)"],
        ["--bezel-border", "color-mix(in srgb, var(--color-white) 7.5%, transparent)"],
        [
          "--command-deck-shadow",
          "0 22px 44px -16px rgb(0 0 0 / 70%), 0 4px 12px -2px rgb(0 0 0 / 42%)",
        ],
        ["--foreground", "#eceef3"],
        ["--card", "#22252c"],
        ["--card-foreground", "var(--foreground)"],
        ["--popover", "#22252c"],
        ["--popover-foreground", "var(--foreground)"],
        ["--primary", "var(--stock-primary-dark, #9b8cff)"],
        ["--primary-foreground", "var(--stock-primary-foreground-dark, #14102e)"],
        ["--primary-hover", "var(--stock-primary-hover-dark, #ada0ff)"],
        ["--primary-edge", "var(--stock-primary-edge-dark, #9b8cff)"],
        ["--primary-text", "var(--stock-primary-text-dark, #b9afff)"],
        ["--primary-surface", "color-mix(in srgb, var(--primary) 12%, transparent)"],
        ["--ring", "var(--primary)"],
        ["--placeholder", "#8c92a0"],
        ["--info", "#60a5fa"],
        ["--success", "#2dd4bf"],
        ["--warning", "#fbbf24"],
        ["--secondary", "--alpha(var(--color-white) / 3%)"],
        ["--secondary-foreground", "#dfe2e8"],
        ["--muted", "--alpha(var(--color-white) / 3%)"],
        ["--muted-foreground", "#9da3b0"],
        ["--accent", "--alpha(var(--color-white) / 4%)"],
        ["--accent-foreground", "var(--foreground)"],
        { comment: "A user turn sits on the composer tone, level with floating surfaces." },
        ["--message-surface", "#22252c"],
        ["--error", "#f87171"],
        ["--error-foreground", "#fca5a5"],
        ["--tool-error-icon", "#fca5a5"],
        ["--error-surface", "color-mix(in srgb, var(--error) 16%, transparent)"],
        ["--border", "rgb(255 255 255 / 7%)"],
        ["--input", "rgb(255 255 255 / 13%)"],
        ["--info-foreground", "#93c5fd"],
        ["--success-foreground", "#5eead4"],
        ["--warning-foreground", "#fcd34d"],
        ["--warning-surface", "color-mix(in srgb, var(--warning) 16%, transparent)"],
        ["--update-foreground", "#93c5fd"],
        ["--update-surface", "color-mix(in srgb, var(--update) 18%, transparent)"],
        ["--merged", "var(--stock-merged-dark, #e879f9)"],
        ["--merged-foreground", "var(--stock-merged-foreground-dark, #f39be6)"],
        ["--merged-surface", "color-mix(in srgb, var(--merged) 16%, transparent)"],
        ["--sidebar", "#13151a"],
        ["--sidebar-control-surface", "var(--muted)"],
        ["--sidebar-row-hover", "var(--accent)"],
        ["--sidebar-row-active", "var(--accent)"],
        ["--sidebar-row-selected", "var(--muted)"],
        ["--sidebar-stage-fade", "var(--sidebar)"],
        ["--terminal-cursor", "var(--stock-terminal-cursor-dark, #9b8cff)"],
        [
          "--terminal-selection-background",
          "var(--stock-terminal-selection-dark, rgb(155 140 255 / 22%))",
        ],
      ],
    },
  ],
};

/** Stock overrides that keep both sidebar implementations on one hierarchy. */
export const STOCK_SIDEBAR: CssRule = {
  rule: "[data-app-sidebar]",
  body: [
    ["--background", "#ffffff"],
    ["--foreground", "#14161b"],
    ["--card", "#ffffff"],
    ["--card-foreground", "#14161b"],
    ["--accent", "#eef0f4"],
    ["--accent-foreground", "#14161b"],
    ["--muted", "#f1f3f6"],
    ["--muted-foreground", "#5a606d"],
    ["--border", "#e3e5ea"],
    ["--input", "#cdd1d9"],
    ["--sidebar", "#f8f9fb"],
    ["--sidebar-foreground", "#14161b"],
    ["--sidebar-muted-foreground", "#5a606d"],
    ["--sidebar-control-surface", "#eceef2"],
    ["--sidebar-row-hover", "#eceef2"],
    ["--sidebar-row-active", "#ffffff"],
    ["--sidebar-row-selected", "#ffffff"],
    ["--sidebar-border", "#e3e5ea"],
    ["--sidebar-stage-fade", "var(--sidebar)"],
    {
      rule: "@variant dark",
      body: [
        ["--background", "#1a1d23"],
        ["--foreground", "#eceef3"],
        ["--card", "#13151a"],
        ["--card-foreground", "var(--foreground)"],
        ["--accent", "#22252c"],
        ["--accent-foreground", "#f1f2f6"],
        ["--muted", "#1a1d23"],
        ["--muted-foreground", "#9da3b0"],
        ["--border", "rgb(255 255 255 / 7%)"],
        ["--input", "rgb(255 255 255 / 16%)"],
        ["--sidebar", "var(--card)"],
        ["--sidebar-foreground", "var(--foreground)"],
        ["--sidebar-muted-foreground", "var(--muted-foreground)"],
        ["--sidebar-control-surface", "var(--muted)"],
        ["--sidebar-row-hover", "color-mix(in srgb, var(--contrast-foreground) 8%, transparent)"],
        ["--sidebar-row-active", "color-mix(in srgb, var(--contrast-foreground) 11%, transparent)"],
        [
          "--sidebar-row-selected",
          "color-mix(in srgb, var(--contrast-foreground) 7%, transparent)",
        ],
        ["--sidebar-border", "var(--border)"],
        ["--sidebar-stage-fade", "var(--card)"],
        { comment: "Row metadata sits a step below read titles." },
        ["--secondary-label", "#8f95a2"],
      ],
    },
  ],
};

/** Placeholder name in `index.css` for each stock block. */
export const WEB_STOCK_BLOCKS = {
  "stock-geometry": STOCK_GEOMETRY,
  "stock-palette": STOCK_PALETTE,
  "stock-sidebar": STOCK_SIDEBAR,
} as const satisfies Record<string, CssRule>;

function renderNode(node: CssNode, indent: string): string[] {
  if ("rule" in node) return renderRuleLines(node, indent);
  if ("comment" in node) {
    const lines = node.comment.split("\n");
    return lines.map(
      (line, index) =>
        `${indent}${index === 0 ? "/* " : "   "}${line}${index === lines.length - 1 ? " */" : ""}`,
    );
  }
  return [`${indent}${node[0]}: ${node[1]};`];
}

function renderRuleLines(rule: CssRule, indent: string): string[] {
  const lines = [`${indent}${rule.rule} {`];
  rule.body.forEach((node, index) => {
    if (index > 0 && "rule" in node) lines.push("");
    lines.push(...renderNode(node, `${indent}  `));
  });
  lines.push(`${indent}}`);
  return lines;
}

/** Renders one rule as CSS, every line prefixed with `indent`. */
export function renderCssRule(rule: CssRule, indent = ""): string {
  return renderRuleLines(rule, indent).join("\n");
}
