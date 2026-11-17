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

/** The rule bodies inside `@starting-style` blocks: what a mount animates from. */
const startingStyleSelectors = [
  ...css.matchAll(/@starting-style\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g),
].flatMap(([, inner]) =>
  [...inner!.matchAll(/([^{}]+)\{/g)].map(([, selector]) => selector!.trim()),
);

type Level = "full" | "reduced" | "off";
const LEVEL_PREFIX = {
  reduced: [':root[data-motion="reduced"]', ":root:not([data-motion])"],
  off: [':root[data-motion="off"]'],
} as const;

/**
 * The custom properties a presence preset ends up with at a level. Rules apply in source
 * order, which in `presets.css` is also specificity order for these selectors.
 */
const presenceAt = (presetClass: string, level: Level, prefix?: string) => {
  const selectors = [".motion-enter", `.${presetClass}`];
  if (level !== "full") {
    const root = prefix ?? LEVEL_PREFIX[level][0];
    selectors.push(`${root} .motion-enter`, `${root} .${presetClass}`);
  }
  const values: Record<string, string> = {};
  for (const rule of rules) {
    if (!selectors.includes(rule.selector)) continue;
    for (const [property, value] of rule.declarations) values[property] = value;
  }
  return {
    from: values["--motion-from"],
    in: values["--motion-in-dur"],
    out: values["--motion-out-dur"],
  };
};

const dur = (name: string) => `var(--dur-${name})`;

/*
 * Design direction 5.4 and 3.9 with the owner's answers on ENG-119: Reduced fades run at
 * dur.quick; tooltips and context menus stay a dur.micro fade; the stream tail has no fade at
 * Reduced. Off is a cut everywhere.
 */
const PRESENCE_TABLE: ReadonlyArray<{
  readonly recipe: keyof typeof MOTION_RECIPES;
  readonly full: { from: string; in: string; out: string };
  readonly reduced: { in: string; out: string };
}> = [
  {
    recipe: "fade",
    full: { from: "none", in: dur("state"), out: dur("quick") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "reveal",
    full: { from: "translateY(var(--distance-reveal))", in: dur("state"), out: dur("quick") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "toast",
    full: { from: "translateY(var(--distance-reveal-max))", in: dur("state"), out: dur("quick") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "pop",
    full: { from: "scale(var(--distance-scale-from))", in: dur("brisk"), out: dur("brisk-exit") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "tooltip",
    full: { from: "none", in: dur("micro"), out: dur("micro") },
    reduced: { in: dur("micro"), out: dur("micro") },
  },
  {
    recipe: "contextMenu",
    full: { from: "none", in: dur("micro"), out: dur("micro") },
    reduced: { in: dur("micro"), out: dur("micro") },
  },
  {
    recipe: "dialogScrim",
    full: { from: "none", in: dur("quick"), out: dur("quick") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "dialog",
    full: { from: "scale(var(--distance-dialog-scale-from))", in: dur("state"), out: dur("quick") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "dolly",
    full: { from: "translateX(var(--distance-dolly))", in: dur("move"), out: dur("quick") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "sideBySide",
    full: { from: "translateX(var(--distance-reveal-max))", in: dur("brisk"), out: dur("micro") },
    reduced: { in: dur("quick"), out: dur("quick") },
  },
  {
    recipe: "streamTail",
    full: { from: "none", in: dur("quick"), out: dur("instant") },
    reduced: { in: dur("instant"), out: dur("instant") },
  },
];

const presetClassOf = (recipe: keyof typeof MOTION_RECIPES) =>
  MOTION_RECIPES[recipe].split(" ").find((name) => name !== "motion-enter")!;

/*
 * Literal values the recipes may hold, each with its reason. Anything else must be a token.
 * 0 and 1 are rest values (opacity, scale, grid cells, one iteration); -1 flips a travel.
 */
const ALLOWED_LITERALS = new Set(["0", "1", "-1", "0.3", "0.8", "1px", "1lh"]);
const ALLOWED_KEYFRAME_STOPS = new Set(["0%", "32%", "50%", "100%"]);

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

  it("keyframes animate only opacity", () => {
    const frames = rules.filter((rule) => KEYFRAME_SELECTOR.test(rule.selector));
    expect(frames.length).toBeGreaterThan(0);
    for (const { declarations } of frames) {
      for (const [property] of declarations) {
        // A keyframe may set the easing of the segment it starts; it animates nothing.
        if (property === "animation-timing-function") continue;
        expect(property).toBe("opacity");
      }
    }
  });

  it("change presence state by transitions, so a toggle retargets instead of queueing", () => {
    for (const { selector, declarations } of rules) {
      if (!selector.includes(".motion-enter")) continue;
      for (const [property] of declarations) expect(property).not.toMatch(/^animation/);
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

  it("takes every duration, curve and amount from the tokens", () => {
    expect(css).not.toMatch(/cubic-bezier\(|linear\(/);
    for (const { selector, declarations } of rules) {
      if (KEYFRAME_SELECTOR.test(selector)) expect(ALLOWED_KEYFRAME_STOPS).toContain(selector);
      for (const [, value] of declarations) {
        const withoutNames = value.replace(/--[\w-]+/g, "");
        for (const [literal] of withoutNames.matchAll(/-?\d*\.?\d+[a-z%]*/g)) {
          expect(ALLOWED_LITERALS, `${selector}: ${value}`).toContain(literal);
        }
      }
    }
  });

  it("defines every recipe class", () => {
    const classes = new Set(Object.values(MOTION_RECIPES).flatMap((names) => names.split(" ")));
    for (const name of classes) expect(css).toMatch(new RegExp(`\\.${name}\\b`));
  });

  it("follows the Full / Reduced / Off table for every presence preset", () => {
    for (const { recipe, full, reduced } of PRESENCE_TABLE) {
      const presetClass = presetClassOf(recipe);
      expect(presenceAt(presetClass, "full"), recipe).toEqual(full);
      for (const prefix of LEVEL_PREFIX.reduced) {
        expect(presenceAt(presetClass, "reduced", prefix), `${recipe} ${prefix}`).toEqual({
          from: "none",
          ...reduced,
        });
      }
      expect(presenceAt(presetClass, "off"), recipe).toEqual({
        from: full.from,
        in: dur("instant"),
        out: dur("instant"),
      });
    }
    const pinned = new Set(PRESENCE_TABLE.map(({ recipe }) => recipe));
    const presence = Object.entries(MOTION_RECIPES).filter(([, names]) =>
      names.startsWith("motion-enter "),
    );
    for (const [recipe] of presence) expect(pinned).toContain(recipe);
  });

  it("cuts or holds still the non-presence presets below Full", () => {
    const ruleWith = (selector: string) =>
      Object.fromEntries(
        rules.find((rule) => rule.selector.includes(selector))?.declarations ?? [],
      );
    for (const root of [...LEVEL_PREFIX.reduced, ...LEVEL_PREFIX.off]) {
      // press, the tab indicator and checkDraw cut.
      expect(ruleWith(`${root} :is(.motion-press, .motion-tab-indicator)`)).toEqual({
        "transition-duration": dur("instant"),
      });
      expect(ruleWith(`${root} .motion-check-draw path`)).toEqual({
        "transition-duration": dur("instant"),
      });
      expect(ruleWith(`${root} .motion-press[data-pressed]`)).toEqual({ transform: "none" });
      // sweep rests on its static ring; skeleton is still.
      expect(ruleWith(`${root} .motion-sweep::after`)).toEqual({ "animation-name": "none" });
      expect(ruleWith(`${root} .motion-skeleton`)).toEqual({ "animation-name": "none" });
    }
  });

  it("plays a mount entrance only with data-enter", () => {
    expect(startingStyleSelectors.length).toBeGreaterThan(0);
    for (const selector of startingStyleSelectors) expect(selector).toContain("[data-enter]");
    for (const { selector, declarations } of rules) {
      const plays = declarations.some(
        ([property, value]) => property === "animation-name" && value !== "none",
      );
      if (plays) expect(selector).toContain("[data-enter]");
    }
  });

  it("changes off-screen presence at once", () => {
    expect(declarationsOf(":root .motion-enter[data-offscreen]")).toEqual({
      "--motion-in-dur": "var(--dur-instant)",
      "--motion-out-dur": "var(--dur-instant)",
    });
  });

  it("cuts at Off", () => {
    const offAnimations = rules.find((rule) =>
      rule.selector.includes(':root[data-motion="off"] .motion-sweep::after'),
    );
    expect(offAnimations?.declarations).toEqual([["animation-name", "none"]]);
  });
});
