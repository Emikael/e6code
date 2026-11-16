// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet from disk.
import * as NodeFS from "node:fs";

import { expect, it } from "vite-plus/test";

const css = NodeFS.readFileSync(new URL("./ambient.css", import.meta.url), "utf8");

/** Declarations as `property: value`, comments removed. */
const declarations = css
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/[;{}]/)
  .map((text) => text.trim().replace(/\s+/g, " "))
  .filter((text) => /^[a-z-]+:/.test(text));

const COLOR_LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|blue|green|gray|grey)\b/i;

// The static gradient must follow every built-in, custom and imported theme, so it may use
// colour roles only. A mask reads alpha alone, so its black carries no colour.
it("uses colour roles only", () => {
  const literals = declarations.filter(
    (declaration) => !declaration.startsWith("mask-image:") && COLOR_LITERAL.test(declaration),
  );
  expect(literals).toEqual([]);
});

it("draws the composition from the ground, key and ray roles", () => {
  const text = declarations.join("\n");
  for (const role of ["--plane-ground", "--light-key", "--light-ray"]) {
    expect(text).toContain(`var(${role})`);
  }
});

it("animates nothing in CSS", () => {
  expect(css).not.toMatch(/@keyframes|animation|transition/);
});
