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
import "culori/css";
import { clampRgb, converter, wcagLuminance, type Oklab } from "culori/fn";
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

const toOklab = converter("oklab");
const PLANES = ["ground", "well", "stage", "raised", "float"] as const;

/**
 * Relative luminance of each plane under a theme that only sets `--background`, computed
 * from the themed block's own expressions. Throws on an expression it cannot evaluate,
 * such as a plane that reads a legacy variable instead of the background.
 */
function themedPlaneLuminance(mode: "dark" | "light", background: string, relativeColour: boolean) {
  const themed = KEY_LIGHT.find((node) => node.rule === THEMED_SELECTOR)!;
  const values = new Map<string, string>();
  const collect = (nodes: ReadonlyArray<CssNode>) => {
    for (const node of nodes) {
      if (Array.isArray(node)) values.set(node[0], node[1]);
      else if ("rule" in node) {
        if (node.rule === "@variant dark" && mode !== "dark") continue;
        if (node.rule.startsWith("@supports") && !relativeColour) continue;
        if (node.rule !== "@variant dark" && !node.rule.startsWith("@supports")) {
          throw new Error(`Unexpected rule ${node.rule}`);
        }
        collect(node.body);
      }
    }
  };
  collect(themed.body);

  const evaluate = (value: string): Oklab => {
    let m: RegExpMatchArray | null;
    if (value === "var(--background)") return toOklab(background)!;
    if ((m = value.match(/^var\((--plane-[a-z]+)\)$/))) return evaluate(values.get(m[1]!)!);
    if ((m = value.match(/^color-mix\(in oklab, (.+) (\d+)%, (black|white)\)$/))) {
      const from = evaluate(m[1]!);
      const to = toOklab(m[3]!)!;
      const t = Number(m[2]) / 100;
      return {
        mode: "oklab",
        l: from.l * t + to.l * (1 - t),
        a: from.a * t + to.a * (1 - t),
        b: from.b * t + to.b * (1 - t),
      };
    }
    if ((m = value.match(/^oklab\(from (.+) max\(l, ([\d.]+)\) a b\)$/))) {
      const from = evaluate(m[1]!);
      return { ...from, l: Math.max(from.l, Number(m[2])) };
    }
    throw new Error(`Cannot evaluate ${value} from the theme background`);
  };

  return Object.fromEntries(
    PLANES.map((plane) => [
      plane,
      wcagLuminance(clampRgb(evaluate(values.get(`--plane-${plane}`)!))),
    ]),
  ) as Record<(typeof PLANES)[number], number>;
}

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

  // ENG-141 decision: under a theme the planes derive from its background, so the Lit Stage
  // order holds whatever the palette. Evaluated from the declared expressions, both where
  // relative colour syntax applies and where its `@supports` block is skipped.
  describe.each([
    ["dark", ["#16181d", "#0b1a10", "#000000", "#050505", "#1e1e2e", "#3b0a5e"]],
    ["light", ["#ffffff", "#fbf1dc", "#eef1f5"]],
  ] as const)("planes of a roles-only %s theme", (mode, backgrounds) => {
    it.each(
      backgrounds.flatMap((background) => [true, false].map((rcs) => [background, rcs] as const)),
    )("keep the Lit Stage order on %s (relative colour %s)", (background, relativeColour) => {
      const L = themedPlaneLuminance(mode, background, relativeColour);
      expect(L.ground).toBeLessThanOrEqual(L.well);
      expect(L.well).toBeLessThanOrEqual(L.stage);
      expect(L.raised).toBeGreaterThanOrEqual(L.stage);
      expect(L.float).toBeGreaterThanOrEqual(L.stage);
      // Strict where it can be: only pure black without the floor collapses.
      if (relativeColour || background !== "#000000") {
        expect(L.ground).toBeLessThan(L.well);
        expect(L.well).toBeLessThan(L.stage);
      }
    });
  });

  it("renders as CSS Tailwind can place after the contrast recompute block", async () => {
    const css = renderIndexCss(await read("../src/index.css"));
    const contrast = css.indexOf("--contrast-sidebar-border:");
    const keyLight = css.indexOf(renderCssRule(KEY_LIGHT));
    expect(contrast).toBeGreaterThan(0);
    expect(keyLight).toBeGreaterThan(contrast);
  });
});
