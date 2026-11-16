// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet from disk.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { MOTION_RECIPES } from "./recipes.ts";

const css = NodeFS.readFileSync(new URL("./presets.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Innermost rules: selector and declarations. At-rule headers are not part of a selector. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector!.trim(),
  declarations: body!
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()] as const;
    }),
}));

const declarationsOf = (selector: string) =>
  Object.fromEntries(rules.find((rule) => rule.selector === selector)?.declarations ?? []);

const KEYFRAME_SELECTOR = /^(from|to|\d+%)$/;

describe("CSS presets", () => {
  it("transition only transform and opacity, except checkDraw's stroke", () => {
    for (const { selector, declarations } of rules) {
      for (const [property, value] of declarations) {
        expect(property).not.toBe("transition");
        if (property !== "transition-property") continue;
        for (const name of value.split(",").map((part) => part.trim())) {
          const allowed = selector.includes(".motion-check-draw")
            ? ["stroke-dashoffset"]
            : ["opacity", "transform"];
          expect(allowed).toContain(name);
        }
      }
    }
  });

  it("keyframe only opacity", () => {
    const frames = rules.filter((rule) => KEYFRAME_SELECTOR.test(rule.selector));
    expect(frames.length).toBeGreaterThan(0);
    for (const { declarations } of frames) {
      for (const [property] of declarations) expect(["opacity", "transform"]).toContain(property);
    }
  });

  it("never loops", () => {
    for (const { declarations } of rules) {
      for (const [property, value] of declarations) {
        if (property === "animation-iteration-count") expect(value).toBe("1");
      }
    }
    const animated = rules.filter((rule) =>
      rule.declarations.some(
        ([property, value]) => property === "animation-name" && value !== "none",
      ),
    );
    for (const { declarations } of animated) {
      expect(declarations.some(([property]) => property === "animation-iteration-count")).toBe(
        true,
      );
    }
  });

  it("takes every duration and curve from the tokens", () => {
    expect(css).not.toMatch(/\d(ms|s)\b/);
    expect(css).not.toMatch(/cubic-bezier\(|linear\(/);
    // Travel is a token; the only literal length is the sweep ring's hairline.
    expect([...css.matchAll(/\d+px/g)].map(([match]) => match)).toEqual(["1px"]);
  });

  it("defines every recipe class", () => {
    const classes = new Set(Object.values(MOTION_RECIPES).flatMap((names) => names.split(" ")));
    for (const name of classes) expect(css).toMatch(new RegExp(`\\.${name}\\b`));
  });

  it("drops travel and scale at Reduced, from the setting or the OS", () => {
    for (const selector of [
      ':root[data-motion="reduced"] .motion-enter',
      ":root:not([data-motion]) .motion-enter",
    ]) {
      expect(declarationsOf(selector)).toEqual({
        "--motion-from": "none",
        "--motion-to": "none",
        "--motion-in-dur": "var(--dur-quick)",
        "--motion-out-dur": "var(--dur-quick)",
      });
    }
  });

  it("cuts at Off", () => {
    expect(declarationsOf(':root[data-motion="off"] .motion-enter')).toEqual({
      "--motion-in-dur": "var(--dur-instant)",
      "--motion-out-dur": "var(--dur-instant)",
    });
    const offAnimations = rules.find((rule) =>
      rule.selector.includes(':root[data-motion="off"] .motion-sweep::after'),
    );
    expect(offAnimations?.declarations).toEqual([["animation-name", "none"]]);
  });
});
