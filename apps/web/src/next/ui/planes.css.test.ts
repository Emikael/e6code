// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet from disk.
import * as NodeFS from "node:fs";

import { PLANE_RECIPES } from "@e6tools/design-tokens/keyLight";
import { describe, expect, it } from "vite-plus/test";

const css = NodeFS.readFileSync(new URL("./planes.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

interface Rule {
  /** Enclosing at-rule headers, outermost first. */
  readonly within: ReadonlyArray<string>;
  readonly selector: string;
  readonly declarations: Readonly<Record<string, string>>;
}

/** Every style rule with the at-rules around it. Keyframe bodies are not style rules. */
function parse(text: string, within: ReadonlyArray<string> = []): Rule[] {
  const rules: Rule[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    for (; depth > 0; close++) {
      if (text[close] === "{") depth++;
      else if (text[close] === "}") depth--;
    }
    const header = text.slice(index, open).trim().replace(/\s+/g, " ");
    const body = text.slice(open + 1, close - 1);
    if (header.startsWith("@keyframes")) {
      // No keyframes are expected; the animation test below fails on them.
    } else if (header.startsWith("@")) {
      rules.push(...parse(body, [...within, header]));
    } else {
      const declarations = Object.fromEntries(
        body
          .split(";")
          .map((declaration) => declaration.trim())
          .filter(Boolean)
          .map((declaration) => {
            const colon = declaration.indexOf(":");
            return [
              declaration.slice(0, colon).trim(),
              declaration
                .slice(colon + 1)
                .trim()
                .replace(/\s+/g, " "),
            ];
          }),
      );
      rules.push({ within, selector: header, declarations });
    }
    index = close;
  }
  return rules;
}

const rules = parse(css);
const topLevel = (selector: string) =>
  rules.find((rule) => rule.within.length === 0 && rule.selector === selector)?.declarations;
const declaring = (property: string) => rules.filter((rule) => property in rule.declarations);

const MATERIAL = '.plane[data-material="float"]';
const OPAQUE = { "--plane-bg": "var(--plane-float)", "backdrop-filter": "none" };

describe("plane", () => {
  it("draws every plane from its Key Light recipe", () => {
    for (const [level, recipe] of Object.entries(PLANE_RECIPES)) {
      expect(topLevel(`.plane[data-plane="${level}"]`), level).toEqual({
        "--plane-bg": `var(${recipe.background})`,
        ...(recipe.edge ? { "--plane-edge": `var(${recipe.edge})` } : {}),
        "--plane-elev": `var(${recipe.elevation})`,
      });
    }
  });

  it("draws an overlay as a floating plane at the overlay elevation", () => {
    expect(topLevel('.plane[data-plane="overlay"]')).toEqual({
      ...topLevel('.plane[data-plane="float"]'),
      "--plane-elev": "var(--elev-4)",
    });
  });

  // A shadow appears by fading the layer that carries it; `box-shadow` itself never animates.
  it("carries the shadow on a pseudo-element and transitions opacity only", () => {
    expect(declaring("box-shadow").map((rule) => rule.selector)).toEqual([".plane::before"]);
    expect(css).not.toMatch(/@keyframes|animation/);
    expect(css).not.toMatch(/transition\s*:/);
    for (const rule of declaring("transition-property")) {
      expect(rule.declarations["transition-property"], rule.selector).toBe("opacity");
    }
  });

  it("uses colour roles only", () => {
    const literal =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black|red|blue|green|gr[ae]y)\b/i;
    const literals = rules.flatMap((rule) =>
      Object.entries(rule.declarations).filter(([, value]) => literal.test(value)),
    );
    expect(literals).toEqual([]);
  });
});

describe("floating material", () => {
  it("blurs over a 72% plane only where backdrop-filter is supported", () => {
    const blurred = declaring("backdrop-filter").filter(
      (rule) => rule.declarations["backdrop-filter"] !== "none",
    );
    expect(blurred).toEqual([
      {
        within: ["@supports (backdrop-filter: blur(1px))"],
        selector: MATERIAL,
        declarations: {
          "--plane-bg": "color-mix(in oklab, var(--plane-float) 72%, transparent)",
          "backdrop-filter": "blur(16px) saturate(140%)",
        },
      },
    ]);
  });

  it("is opaque under Reduced, with the OS setting before a level is written, and on touch-first web", () => {
    const opaque = rules.filter((rule) => rule.declarations["backdrop-filter"] === "none");
    expect(opaque.map((rule) => [...rule.within, rule.selector].join(" > "))).toEqual([
      `:root[data-motion="reduced"] ${MATERIAL}`,
      `@media (prefers-reduced-motion: reduce) > :root:not([data-motion]) ${MATERIAL}`,
      `@media (pointer: coarse) and (hover: none) > :root ${MATERIAL}`,
    ]);
    for (const rule of opaque) expect(rule.declarations, rule.selector).toEqual(OPAQUE);
  });

  // The opaque rules come after the blur and are at least as specific, so they win.
  it("declares the opaque fallbacks after the blur", () => {
    const blurAt = css.indexOf("blur(16px)");
    expect(blurAt).toBeGreaterThan(-1);
    expect(css.indexOf("backdrop-filter: none")).toBeGreaterThan(blurAt);
  });
});

describe("scrim and light wash", () => {
  it("dims through the scrim role and never blurs", () => {
    expect(topLevel(".scrim")).toMatchObject({ "background-color": "var(--scrim)" });
    expect(Object.keys(topLevel(".scrim")!)).not.toContain("backdrop-filter");
  });

  it("lights with a static gradient shown by opacity", () => {
    expect(topLevel(".light-wash")).toMatchObject({
      opacity: "0",
      "background-image": "radial-gradient(closest-side, var(--wash), transparent)",
    });
    expect(topLevel(".light-wash[data-on]")).toEqual({ opacity: "1" });
    expect(topLevel('.light-wash[data-kind="key"]')).toEqual({ "--wash": "var(--light-key)" });
    expect(topLevel('.light-wash[data-kind="attention"]')).toEqual({
      "--wash": "var(--light-attention)",
    });
  });

  it("cuts every fade at Off", () => {
    const off = rules.filter((rule) => rule.selector.startsWith(':root[data-motion="off"]'));
    expect(off.length).toBeGreaterThan(0);
    for (const rule of off) {
      expect(rule.declarations).toEqual({ "transition-duration": "var(--dur-instant)" });
    }
    const fading = declaring("transition-property").map((rule) => rule.selector);
    const cut = off.flatMap((rule) =>
      rule.selector.split(",").map((part) => part.trim().replace(':root[data-motion="off"] ', "")),
    );
    expect(cut.toSorted()).toEqual(fading.toSorted());
  });
});
