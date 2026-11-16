// @effect-diagnostics nodeBuiltinImport:off - reads the artwork sources from the repository.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { BRAND_CHANNELS, BRAND_GLYPH, brandTileGeometry } from "./brand.ts";

const read = (path: string) => NodeFS.readFileSync(new URL(path, import.meta.url), "utf8");

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(first: string, second: string): number {
  const [high, low] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}

describe("brand glyph", () => {
  // Hand-copied artwork drifts silently; every copy of the letterforms must be this one.
  it("is the same path in every artwork source", () => {
    for (const source of [
      "../../../assets/dev/app-icon.icon/Assets/text.svg",
      "../../../assets/nightly/app-icon.icon/Assets/text.svg",
      "../../../assets/prod/app-icon.icon/Assets/text.svg",
      "../../../assets/prod/logo.svg",
      "../../../apps/mobile/assets/widget/E6Mark.svg",
    ]) {
      expect(read(source), source).toContain(`d="${BRAND_GLYPH.path}"`);
    }
  });
});

describe("brand channels", () => {
  it("paints each Icon Composer project in its channel's colours", () => {
    for (const [channel, colors] of Object.entries(BRAND_CHANNELS)) {
      const background = read(`../../../assets/${channel}/app-icon.icon/Assets/background.svg`);
      const text = read(`../../../assets/${channel}/app-icon.icon/Assets/text.svg`);
      expect(background.toLowerCase(), channel).toContain(`fill="${colors.ground}"`);
      expect(background.toLowerCase(), channel).toContain(`fill="${colors.band}"`);
      expect(text.toLowerCase(), channel).toContain(`fill="${colors.glyph}"`);
    }
  });

  it("keeps glyph and band readable on every channel's ground", () => {
    for (const [channel, colors] of Object.entries(BRAND_CHANNELS)) {
      expect(contrastRatio(colors.glyph, colors.ground), channel).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.band, colors.ground), channel).toBeGreaterThanOrEqual(3);
    }
  });

  it("tells the channels apart by brightness", () => {
    const [dark, mid, light] = [BRAND_CHANNELS.prod, BRAND_CHANNELS.nightly, BRAND_CHANNELS.dev];
    expect(contrastRatio(dark.ground, mid.ground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(mid.ground, light.ground)).toBeGreaterThanOrEqual(3);
  });
});

describe("brand tile geometry", () => {
  it("centres the glyph above the band in both cuts", () => {
    for (const cut of ["default", "small"] as const) {
      const { band, glyph } = brandTileGeometry(cut);
      expect(glyph.x * 2 + glyph.width).toBeCloseTo(128);
      expect(glyph.y + glyph.height).toBeLessThan(128 - band);
      expect(glyph.width / glyph.height).toBeCloseTo(BRAND_GLYPH.width / BRAND_GLYPH.height);
    }
  });

  it("draws the small cut's band at exactly 2 px at 16 px", () => {
    expect((brandTileGeometry("small").band / 128) * 16).toBe(2);
  });
});
