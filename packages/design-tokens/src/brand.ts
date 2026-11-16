/**
 * The E6 brand mark, design v2 "Graphite" (ENG-121): an ink tile, a paper glyph and one solid
 * band along the bottom. This file is the one geometry and colour source for the in-app tile
 * (`E6Monogram`), the boot tile in `index.html`, both wordmarks, and the artwork tests that keep
 * the Icon Composer sources in step.
 *
 * The brand values are fixed and never themed: the mark is an object, not a surface. Inside the
 * app only the band changes, through `--mark-band`, which follows the Accent setting.
 */
import type { StockAccent } from "@e6tools/contracts/settings";

import { STOCK_ACCENT_PALETTES } from "./themePalettes.ts";
import type { CssRule } from "./webStock.ts";

export const BRAND_COLORS = {
  ink: "#16181d",
  paper: "#f8fafc",
  graphite: "#aab0bc",
  graphiteMid: "#6b7180",
  graphiteDeep: "#4a4f5a",
  porcelain: "#eef0f5",
} as const;

/** The "E6" letterforms on their own 95 × 59 box inside a 128-unit tile. */
export const BRAND_GLYPH = {
  path: "M16 37H59V48H29V60H56V71H29V83H59V94H16ZM88 36C99 36 106 40 110 49L99 54C97 49 93 47 88 47C80 47 75 53 75 62C79 58 84 56 90 56C102 56 111 64 111 75C111 87 101 95 88 95C72 95 62 84 62 67C62 48 72 36 88 36ZM88 67C80 67 75 71 75 76C75 81 80 84 88 84C95 84 99 81 99 76C99 71 95 67 88 67Z",
  viewBox: "16 36 95 59",
  x: 16,
  y: 36,
  width: 95,
  height: 59,
} as const;

/**
 * Channels are told apart by brightness, never by hue: production is dark, nightly is mid
 * graphite, dev is light. Used by the app icon artwork and Android's adaptive background.
 */
export const BRAND_CHANNELS = {
  prod: { ground: BRAND_COLORS.ink, glyph: BRAND_COLORS.paper, band: BRAND_COLORS.graphite },
  nightly: { ground: BRAND_COLORS.graphiteMid, glyph: BRAND_COLORS.paper, band: BRAND_COLORS.ink },
  dev: { ground: BRAND_COLORS.porcelain, glyph: BRAND_COLORS.ink, band: BRAND_COLORS.graphiteDeep },
} as const;

/** The tile is drawn on a 128-unit grid. */
export const BRAND_TILE_UNITS = 128;

/**
 * `small` is the cut for 20 px and below: a larger glyph and a band of exactly 2 px at 16 px,
 * so the mark survives favicon and sidebar sizes.
 */
export type BrandTileCut = "default" | "small";

const CUTS = {
  default: { radius: 0.27, band: 18, glyphHeight: 0.36 * BRAND_TILE_UNITS, glyphCenterY: 55 },
  small: { radius: 0.25, band: 16, glyphHeight: 56, glyphCenterY: 56 },
} as const;

/** Tile geometry in 128-unit coordinates; `radius` is a fraction of the tile side. */
export function brandTileGeometry(cut: BrandTileCut = "default") {
  const { radius, band, glyphHeight, glyphCenterY } = CUTS[cut];
  const glyphWidth = (glyphHeight * BRAND_GLYPH.width) / BRAND_GLYPH.height;
  return {
    radius,
    band,
    glyph: {
      x: BRAND_TILE_UNITS / 2 - glyphWidth / 2,
      y: glyphCenterY - glyphHeight / 2,
      width: glyphWidth,
      height: glyphHeight,
    },
  };
}

const round = (value: number) => Number(value.toFixed(3));

/**
 * The tile as standalone SVG markup. Colours are any CSS colour, `var()` included (they are written
 * as `style`, where `var()` works), so the boot shell can let its band follow a custom property. `id` names the clip path and must be unique
 * in the document.
 */
export function renderBrandTileSvg(options: {
  readonly id: string;
  readonly size: number;
  readonly ground: string;
  readonly glyph: string;
  readonly band: string;
  readonly label: string;
  readonly cut?: BrandTileCut;
}): string {
  const geometry = brandTileGeometry(options.cut);
  const units = BRAND_TILE_UNITS;
  const scale = geometry.glyph.height / BRAND_GLYPH.height;
  const glyphTransform = `translate(${round(geometry.glyph.x)} ${round(geometry.glyph.y)}) scale(${round(scale)}) translate(-${BRAND_GLYPH.x} -${BRAND_GLYPH.y})`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="0 0 ${units} ${units}" role="img" aria-label="${options.label}">`,
    `<clipPath id="${options.id}"><rect width="${units}" height="${units}" rx="${round(geometry.radius * units)}"/></clipPath>`,
    `<g clip-path="url(#${options.id})">`,
    `<rect width="${units}" height="${units}" style="fill:${options.ground}"/>`,
    `<rect data-slot="brand-band" y="${units - geometry.band}" width="${units}" height="${geometry.band}" style="fill:${options.band}"/>`,
    `</g>`,
    `<path d="${BRAND_GLYPH.path}" fill-rule="evenodd" style="fill:${options.glyph}" transform="${glyphTransform}"/>`,
    `</svg>`,
  ].join("");
}

/**
 * The in-app band for a stock accent. It always sits on ink, so it takes the accent's dark
 * value in both appearances (a light `--primary` can measure 1.29:1 on ink). Graphite maps to
 * the brand graphite, so with that accent the in-app tile is exactly the brand mark.
 */
export function stockAccentMarkBand(accent: StockAccent): string {
  return accent === "graphite" ? BRAND_COLORS.graphite : STOCK_ACCENT_PALETTES[accent].dark.primary;
}

/** The `brand` block of `index.css`. */
export const BRAND: CssRule = {
  rule: ":root",
  body: [
    ["--brand-ink", BRAND_COLORS.ink],
    ["--brand-paper", BRAND_COLORS.paper],
    {
      comment:
        "The tile's band follows the Accent setting. Stock accents write --stock-mark-band\n(stockAccent.ts) and themes write --app-theme-mark-band (themePalette.ts), both\nlifted to 3:1 on ink; the literal is Iris's dark value, the default accent.",
    },
    [
      "--mark-band",
      `var(--app-theme-mark-band, var(--stock-mark-band, ${stockAccentMarkBand("iris")}))`,
    ],
  ],
};

export const BRAND_BLOCKS = { brand: BRAND } as const;
