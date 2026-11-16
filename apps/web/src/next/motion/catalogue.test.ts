// @effect-diagnostics nodeBuiltinImport:off - reads the sourcing register from disk.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { MOTION_CATALOGUE } from "./catalogue.ts";
import { numberSlots } from "./presets/numberSlots.ts";
import { MOTION_RECIPES } from "./presets/recipes.ts";

// Design direction 5.4 and 3.9.
const PRESETS = [
  "cut",
  "fade",
  "reveal",
  "swap",
  "iconSwap",
  "numberChange",
  "checkDraw",
  "press",
  "pop",
  "dolly",
  "matchCut",
  "layout",
  "sideBySide",
  "sweep",
  "shake",
];
const MOMENTS = ["toast", "tooltip", "contextMenu", "dialog", "tabIndicator", "copyConfirm"];

describe("motion catalogue", () => {
  it("has every preset and catalogue moment", () => {
    const names = MOTION_CATALOGUE.map((entry) => entry.name);
    for (const name of [...PRESETS, ...MOMENTS]) expect(names).toContain(name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("points CSS entries at real recipes", () => {
    for (const entry of MOTION_CATALOGUE) {
      if (entry.engine === "css") expect(Object.keys(MOTION_RECIPES)).toContain(entry.use);
    }
  });

  it("credits every borrowed idea in the sourcing register", () => {
    const register = NodeFS.readFileSync(
      new URL("../../../../../docs/internals/design-sourcing.md", import.meta.url),
      "utf8",
    );
    for (const { name, credit } of MOTION_CATALOGUE) {
      if (credit === undefined) continue;
      const row = register.split("\n").find((line) => line.includes(`\`${name}\``));
      expect(row, `register row for ${name}`).toBeDefined();
    }
  });
});

describe("numberSlots", () => {
  it("keeps unchanged digits in their slot when the number grows", () => {
    const before = numberSlots("128");
    const after = numberSlots("1,128");
    for (const slot of before) expect(after).toContainEqual(slot);
  });

  it("gives only a changed digit a new key", () => {
    const before = numberSlots("129");
    const after = numberSlots("130");
    const changed = after.filter(
      (slot) => !before.some((old) => old.slot === slot.slot && old.char === slot.char),
    );
    expect(changed.map(({ char }) => char)).toEqual(["3", "0"]);
  });
});
