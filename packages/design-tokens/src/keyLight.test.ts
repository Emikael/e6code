import { describe, expect, it } from "vite-plus/test";

import { KEY_LIGHT, RADII, TYPE_SCALE } from "./keyLight.ts";
import type { CssNode, CssRule } from "./webStock.ts";

/** Declarations of the rule at `path` (rule headers from the block down), as a map. */
function declarationsAt(path: ReadonlyArray<string>): Record<string, string> {
  let nodes: ReadonlyArray<CssNode> = KEY_LIGHT;
  let rule: CssRule | undefined;
  for (const header of path) {
    rule = nodes.find((node): node is CssRule => "rule" in node && node.rule === header);
    if (!rule) throw new Error(`No rule ${path.join(" > ")}`);
    nodes = rule.body;
  }
  return Object.fromEntries(nodes.filter((node) => Array.isArray(node)) as [string, string][]);
}

const STOCK = ":root";
const DERIVED = ":root, [data-app-sidebar]";
const THEMED = 'html[data-theme-id]:not([data-theme-id=""])';

// Direction C "Lit Stage", approved 2026-11-15 (ENG-141). A change here is a design change.
describe("key-light stock values (direction C)", () => {
  it("lights the planes with direction C literals", () => {
    expect(declarationsAt([STOCK])).toMatchObject({
      "--plane-ground": "#f0f1f4",
      "--plane-stage": "#ffffff",
      "--plane-well": "#f3f4f6",
      "--plane-raised": "#ffffff",
      "--plane-float": "#ffffff",
      "--light-rim": "rgb(255 255 255 / 72%)",
      "--elev-0": "none",
      "--elev-1": "0 1px 2px rgb(20 22 27 / 6%), 0 20px 50px -24px rgb(20 22 27 / 22%)",
      "--elev-2": "0 1px 3px rgb(20 22 27 / 7%)",
      "--elev-3": "0 20px 44px -16px rgb(20 22 27 / 26%), 0 2px 6px rgb(20 22 27 / 6%)",
      "--elev-4": "var(--elev-3)",
    });
    expect(declarationsAt([STOCK, "@variant dark"])).toEqual({
      "--plane-ground": "#08090b",
      "--plane-stage": "#16181d",
      "--plane-well": "#0f1115",
      "--plane-raised": "#1b1e25",
      "--plane-float": "#1c1f26",
      "--light-rim": "rgb(255 255 255 / 8%)",
      "--elev-1": "inset 0 1px 0 rgb(255 255 255 / 6%), 0 30px 80px -30px rgb(0 0 0 / 85%)",
      "--elev-2": "inset 0 1px 0 var(--light-rim)",
      "--elev-3": "inset 0 1px 0 var(--light-rim), 0 20px 48px -16px rgb(0 0 0 / 72%)",
    });
  });

  it("derives edges, key light, attention and scrim from today's roles", () => {
    const edge = (percent: number) =>
      `color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, var(--foreground) ${percent}%, transparent) var(--appearance-contrast-base), transparent), var(--foreground) var(--appearance-contrast-border-boost))`;
    expect(declarationsAt([DERIVED])).toEqual({
      "--edge-subtle": edge(8),
      "--edge-strong": edge(15),
      "--light-key": "color-mix(in oklab, var(--primary) 15%, transparent)",
      "--light-attention": "color-mix(in oklab, var(--warning) 12%, transparent)",
      "--scrim": "color-mix(in oklab, var(--foreground) 30%, transparent)",
    });
    expect(declarationsAt([DERIVED, "@variant dark"])).toEqual({
      "--edge-subtle": edge(6),
      "--edge-strong": edge(12),
      "--light-key": "color-mix(in oklab, var(--primary) 30%, transparent)",
      "--light-attention": "color-mix(in oklab, var(--warning) 22%, transparent)",
      "--scrim": "color-mix(in oklab, var(--plane-ground) 66%, transparent)",
    });
  });

  // The Lit Stage order these derivations must keep is tested with colour maths in
  // `apps/web/vite/keyLight.test.ts`; here, only that the floor stays behind `@supports`.
  it("derives themed planes from the theme background, floor behind @supports", () => {
    expect(declarationsAt([THEMED])["--plane-stage"]).toBe("var(--background)");
    expect(
      declarationsAt([THEMED, "@variant dark", "@supports (color: oklab(from red l a b))"]),
    ).toEqual({ "--plane-stage": "oklab(from var(--background) max(l, 0.16) a b)" });
  });

  it("carries the motion scale as CSS variables", () => {
    expect(declarationsAt([STOCK])).toMatchObject({
      "--dur-instant": "0ms",
      "--dur-micro": "90ms",
      "--dur-quick": "140ms",
      "--dur-state": "200ms",
      "--dur-move": "280ms",
      "--dur-scene": "420ms",
      "--ease-enter": "cubic-bezier(0.22, 1, 0.36, 1)",
      "--ease-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      "--ease-shift": "cubic-bezier(0.65, 0, 0.35, 1)",
      "--ease-exit": "cubic-bezier(0.55, 0.055, 0.675, 0.19)",
    });
  });

  it("keeps type and radii as rem data at a 16 px root", () => {
    expect(TYPE_SCALE.prose).toEqual({
      size: "0.9375rem",
      lineHeight: "1.5rem",
      weight: "400",
      tracking: "0",
    });
    expect(TYPE_SCALE.heading).toEqual({
      size: "1.1875rem",
      lineHeight: "1.5rem",
      weight: "var(--weight-strong, 650)",
      tracking: "-0.02em",
    });
    expect(TYPE_SCALE.display).toMatchObject({ size: "2.25rem", lineHeight: "2.5rem" });
    expect(RADII).toEqual({
      kbd: "0.25rem",
      chip: "0.375rem",
      control: "0.5rem",
      card: "0.75rem",
      stage: "1rem",
      overlay: "1rem",
    });
  });
});
