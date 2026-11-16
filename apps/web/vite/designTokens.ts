// @effect-diagnostics nodeBuiltinImport:off - a Vite plugin running in Node.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  BOOT_SCRIPT_BLOCKS,
  BOOT_THEME_COLOR,
  renderBootStyle,
} from "@e6tools/design-tokens/bootPalette";
import { BRAND_COLORS, renderBrandTileSvg } from "@e6tools/design-tokens/brand";
import { WEB_STOCK_BLOCKS, renderCssRule } from "@e6tools/design-tokens/webStock";
import type { Plugin } from "vite-plus";

type Blocks = Readonly<Record<string, (indent: string) => string>>;

/** A whole line holding only `/* @design-tokens <name> *\/`; its indentation is kept. */
const PLACEHOLDER = /^([ \t]*)\/\* @design-tokens ([a-z-]+) \*\/$/gm;
const BOOT_THEME_COLOR_PLACEHOLDER = "%E6_BOOT_THEME_COLOR%";

const CSS_BLOCKS: Blocks = Object.fromEntries(
  Object.entries(WEB_STOCK_BLOCKS).map(([name, rule]) => [
    name,
    (indent: string) => renderCssRule(rule, indent),
  ]),
);
// The boot tile is the in-app tile at 64 px, so the launch can match-cut to the header.
// Its band is graphite until something writes --boot-mark-band.
const renderBootMark = (indent: string) =>
  indent +
  renderBrandTileSvg({
    id: "boot-mark-clip",
    size: 64,
    ground: BRAND_COLORS.ink,
    glyph: BRAND_COLORS.paper,
    band: `var(--boot-mark-band, ${BRAND_COLORS.graphite})`,
    label: "E6 Code",
  });

const HTML_BLOCKS: Blocks = {
  ...BOOT_SCRIPT_BLOCKS,
  "boot-style": renderBootStyle,
  "boot-mark": renderBootMark,
};

function injectBlocks(source: string, blocks: Blocks): string {
  return source.replace(PLACEHOLDER, (_line, indent: string, name: string) => {
    const render = blocks[name];
    if (!render) throw new Error(`Unknown design-tokens placeholder "${name}"`);
    return render(indent);
  });
}

/** `apps/web/src/index.css` with its stock token blocks rendered in place. */
export function renderIndexCss(source: string): string {
  return injectBlocks(source, CSS_BLOCKS);
}

/** `apps/web/index.html` with its boot palette, boot styles and theme-color rendered in place. */
export function renderIndexHtml(source: string): string {
  return injectBlocks(source, HTML_BLOCKS).replaceAll(
    BOOT_THEME_COLOR_PLACEHOLDER,
    BOOT_THEME_COLOR,
  );
}

const TOKENS_SOURCE_DIR = NodeURL.fileURLToPath(
  new URL("../../../packages/design-tokens/src/", import.meta.url),
);

/**
 * Renders `@design-tokens` placeholders in CSS modules and `index.html`. Register it before
 * Tailwind: both run as `pre` transforms, in plugin order, and Tailwind must compile the
 * rendered text. Dev and build share these hooks, so they serve the same values.
 */
export function designTokensPlugin(): Plugin {
  return {
    name: "e6:design-tokens",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?", 1)[0]!.endsWith(".css") || !code.includes("/* @design-tokens ")) return;
      return { code: renderIndexCss(code), map: null };
    },
    transformIndexHtml: { order: "pre", handler: renderIndexHtml },
    configureServer(server) {
      // Token modules load with the Vite config, so an edit needs a restart, not HMR.
      server.watcher.add(TOKENS_SOURCE_DIR);
      server.watcher.on("change", (file) => {
        if (NodePath.resolve(file).startsWith(TOKENS_SOURCE_DIR)) void server.restart();
      });
    },
  };
}
