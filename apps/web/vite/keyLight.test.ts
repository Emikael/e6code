// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet and sources from disk.
import * as NodeFSP from "node:fs/promises";

import { KEY_LIGHT } from "@e6tools/design-tokens/keyLight";
import { THEME_COLOR_ROLES } from "@e6tools/design-tokens/themePalettes";
import {
  STOCK_GEOMETRY,
  STOCK_PALETTE,
  renderCssRule,
  type CssNode,
} from "@e6tools/design-tokens/webStock";
import { describe, expect, it } from "vite-plus/test";

import { getThemeColorVariable } from "../src/themePalette";
import { renderIndexCss } from "./designTokens";

const read = (path: string) => NodeFSP.readFile(new URL(path, import.meta.url), "utf8");

const DECLARATION = /(--[\w-]+)\s*:/g;
const VAR_REFERENCE = /var\((--[\w-]+)/g;
const THEMED_SELECTOR = 'html[data-theme-id]:not([data-theme-id=""])';

const declaredIn = (css: string) => new Set([...css.matchAll(DECLARATION)].map((m) => m[1]!));
const referencedIn = (value: string) => [...value.matchAll(VAR_REFERENCE)].map((m) => m[1]!);

function declarations(nodes: ReadonlyArray<CssNode>): Array<[string, string]> {
  return nodes.flatMap((node) =>
    "rule" in node ? declarations(node.body) : "comment" in node ? [] : [[node[0], node[1]]],
  );
}

const keyLightNames = new Set(declarations(KEY_LIGHT).map(([name]) => name));

/** `index.css` rendered with every block except key-light, so only legacy names remain. */
async function legacyIndexCss() {
  const raw = await read("../src/index.css");
  return renderIndexCss(raw.replace("/* @design-tokens key-light */", ""));
}

/** Every `.ts`/`.tsx` source under `apps/web/src`, excluding tests. */
async function webSources(): Promise<string[]> {
  const dir = new URL("../src/", import.meta.url);
  const files = await NodeFSP.readdir(dir, { recursive: true });
  return Promise.all(
    files
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => NodeFSP.readFile(new URL(file, dir), "utf8")),
  );
}

describe("key-light tokens", () => {
  // A new name that equals a legacy one would retime, resize or recolour legacy UI.
  it("declares no name that legacy CSS, Tailwind or runtime code already declares", async () => {
    const legacy = declaredIn(await legacyIndexCss());
    for (const name of declaredIn(await read("../node_modules/tailwindcss/theme.css"))) {
      legacy.add(name);
    }
    for (const source of await webSources()) {
      for (const match of source.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g))
        legacy.add(match[1]!);
      for (const match of source.matchAll(/\[(--[\w-]+):/g)) legacy.add(match[1]!);
    }
    expect(legacy.has("--ease-out")).toBe(true);
    expect(legacy.has("--radius-panel")).toBe(true);

    expect([...keyLightNames].filter((name) => legacy.has(name))).toEqual([]);
  });

  // The "no new required theme field" proof: every derivation reads only variables that
  // exist for every theme source, stock or themed.
  it("derives only from variables every theme source provides", async () => {
    const css = await read("../src/index.css");
    const themedStart = css.indexOf(`${THEMED_SELECTOR} {`);
    const themedBlock = css.slice(themedStart, css.indexOf("\n}", themedStart));
    const themedMappings = new Map(
      [...themedBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]),
    );
    const roleVariables = new Set(THEME_COLOR_ROLES.map(getThemeColorVariable));
    const paletteIndependent = new Set(declarations(STOCK_GEOMETRY.body).map(([name]) => name));
    const stock = new Set(declarations(STOCK_PALETTE.body).map(([name]) => name));

    const missing: string[] = [];
    for (const [name, value] of declarations(KEY_LIGHT)) {
      for (const variable of referencedIn(value)) {
        if (keyLightNames.has(variable) || paletteIndependent.has(variable)) continue;
        const themed = themedMappings.get(variable);
        const themedFromRoles =
          themed !== undefined &&
          referencedIn(themed).every((reference) => roleVariables.has(reference));
        if (!stock.has(variable) || !themedFromRoles) missing.push(`${name} -> ${variable}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("renders as CSS Tailwind can place after the contrast recompute block", async () => {
    const css = renderIndexCss(await read("../src/index.css"));
    const contrast = css.indexOf("--contrast-sidebar-border:");
    const keyLight = css.indexOf(renderCssRule(KEY_LIGHT));
    expect(contrast).toBeGreaterThan(0);
    expect(keyLight).toBeGreaterThan(contrast);
  });
});
