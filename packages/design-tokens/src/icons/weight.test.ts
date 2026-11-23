import { describe, expect, it } from "vite-plus/test";

import { iconWeight, iconWeightsFor } from "./weight.ts";

// A generated component bakes only these traits, so the rule must work without a registry entry.
describe("iconWeight on baked traits", () => {
  const fills = { fillWhenActive: true } as const;
  const line = { fillWhenActive: false } as const;
  const illustration = { fillWhenActive: true, illustration: true } as const;

  it.each([
    ["fills when active", fills, { sizePx: 16, state: "active" }, "fill"],
    ["turns bold at 14 px", fills, { sizePx: 14 }, "bold"],
    ["stays regular at 16 px", fills, { sizePx: 16 }, "regular"],
    ["keeps a line glyph bold when active at 14 px", line, { sizePx: 14, state: "active" }, "bold"],
    [
      "draws an illustration in duotone",
      illustration,
      { sizePx: 48, illustration: true },
      "duotone",
    ],
  ] as const)("%s", (_, traits, options, weight) => {
    expect(iconWeight(traits, options)).toBe(weight);
  });

  it("lists only the weights the traits can resolve to", () => {
    expect(iconWeightsFor(line)).toEqual(["regular", "bold"]);
    expect(iconWeightsFor(fills)).toEqual(["regular", "bold", "fill"]);
    expect(iconWeightsFor(illustration)).toEqual(["regular", "bold", "fill", "duotone"]);
  });
});
