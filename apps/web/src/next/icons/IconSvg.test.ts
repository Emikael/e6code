import { describe, expect, it } from "vite-plus/test";

import { iconA11yAttributes, type IconSize, selectIconArtwork } from "./IconSvg.tsx";

describe("iconA11yAttributes", () => {
  it("names an icon that carries meaning alone", () => {
    expect(iconA11yAttributes("Pinned")).toEqual({ role: "img", "aria-label": "Pinned" });
  });

  it.each([undefined, "", "   "])("hides an icon without a usable label (%j)", (label) => {
    expect(iconA11yAttributes(label)).toEqual({ "aria-hidden": true });
  });
});

describe("selectIconArtwork", () => {
  const artwork = { regular: "regular", bold: "bold", fill: "fill" } as const;
  const fills = { fillWhenActive: true } as const;
  const line = { fillWhenActive: false } as const;

  it.each([
    ["bold at 14 px", fills, 14, "rest", "bold"],
    ["regular at 16 px", fills, 16, "rest", "regular"],
    ["regular at 20 px", fills, 20, "rest", "regular"],
    ["fill when active", fills, 16, "active", "fill"],
    ["fill over bold when active at 14 px", fills, 14, "active", "fill"],
    ["regular for an active line glyph at 16 px", line, 16, "active", "regular"],
    ["bold for an active line glyph at 14 px", line, 14, "active", "bold"],
  ] as const)("draws %s", (_, traits, size, state, drawn) => {
    expect(selectIconArtwork(artwork, traits, { size, state })).toBe(drawn);
  });

  it("falls back to regular when the weight has no drawing", () => {
    const regularOnly = { regular: "regular" } as const;
    expect(selectIconArtwork(regularOnly, fills, { size: 14, state: "rest" })).toBe("regular");
    expect(selectIconArtwork(regularOnly, fills, { size: 16, state: "active" })).toBe("regular");
  });
});

describe("IconSize", () => {
  // tsc checks the directives: each fails the typecheck once the size it marks becomes valid.
  it("admits 14, 16 and 20 px only", () => {
    const sizes: ReadonlyArray<IconSize> = [
      14, 16, 20,
      // @ts-expect-error 12 px is not an icon size (open with the maintainer as M1).
      12,
      // @ts-expect-error 18 px is not an icon size.
      18,
    ];
    expect(sizes).toHaveLength(5);
  });
});
