import { describe, expect, it } from "vite-plus/test";

import { contrastRatio } from "../fixtures/contrast";
import { PROJECT_ICON_COLORS, projectMonogramClassName } from "../projectIconColors";

// Tailwind v4 default palette shades used by the solid monogram tiles.
const MONOGRAM_OKLCH: Record<string, string> = {
  "gray-100": "96.7% 0.003 264.542",
  "gray-900": "21% 0.034 264.665",
  "gray-950": "13% 0.028 261.692",
  "red-100": "93.6% 0.032 17.717",
  "red-900": "39.6% 0.141 25.723",
  "red-950": "25.8% 0.092 26.042",
  "orange-100": "95.4% 0.038 75.164",
  "orange-900": "40.8% 0.123 38.172",
  "orange-950": "26.6% 0.079 36.259",
  "amber-100": "96.2% 0.059 95.617",
  "amber-900": "41.4% 0.112 45.904",
  "amber-950": "27.9% 0.077 45.635",
  "yellow-100": "97.3% 0.071 103.193",
  "yellow-900": "42.1% 0.095 57.708",
  "yellow-950": "28.6% 0.066 53.813",
  "lime-100": "96.7% 0.067 122.328",
  "lime-900": "40.5% 0.101 131.063",
  "lime-950": "27.4% 0.072 132.109",
  "green-100": "96.2% 0.044 156.743",
  "green-900": "39.3% 0.095 152.535",
  "green-950": "26.6% 0.065 152.934",
  "emerald-100": "95% 0.052 163.051",
  "emerald-900": "37.8% 0.077 168.94",
  "emerald-950": "26.2% 0.051 172.552",
  "teal-100": "95.3% 0.051 180.801",
  "teal-900": "38.6% 0.063 188.416",
  "teal-950": "27.7% 0.046 192.524",
  "cyan-100": "95.6% 0.045 203.388",
  "cyan-900": "39.8% 0.07 227.392",
  "cyan-950": "30.2% 0.056 229.695",
  "sky-100": "95.1% 0.026 236.824",
  "sky-900": "39.1% 0.09 240.876",
  "sky-950": "29.3% 0.066 243.157",
  "blue-100": "93.2% 0.032 255.585",
  "blue-900": "37.9% 0.146 265.522",
  "blue-950": "28.2% 0.091 267.935",
  "indigo-100": "93% 0.034 272.788",
  "indigo-900": "35.9% 0.144 278.697",
  "indigo-950": "25.7% 0.09 281.288",
  "violet-100": "94.3% 0.029 294.588",
  "violet-900": "38% 0.189 293.745",
  "violet-950": "28.3% 0.141 291.089",
  "purple-100": "94.6% 0.033 307.174",
  "purple-900": "38.1% 0.176 304.987",
  "purple-950": "29.1% 0.149 302.717",
  "fuchsia-100": "95.2% 0.037 318.852",
  "fuchsia-900": "40.1% 0.17 325.612",
  "fuchsia-950": "29.3% 0.136 325.661",
  "pink-100": "94.8% 0.028 342.258",
  "pink-900": "40.8% 0.153 2.432",
  "pink-950": "28.4% 0.109 3.907",
  "rose-100": "94.1% 0.03 12.58",
  "rose-900": "41% 0.159 10.272",
  "rose-950": "27.1% 0.105 12.094",
};

const THEME_APPEARANCES = [
  "default/light",
  "default/dark",
  "e6-chat/light",
  "e6-chat/dark",
  "grove/light",
  "grove/dark",
  "ocean/light",
  "ocean/dark",
  "ember/light",
  "ember/dark",
  "iris/light",
  "iris/dark",
] as const;

function oklch(name: string): readonly [number, number, number] {
  const body = MONOGRAM_OKLCH[name];
  if (!body) throw new Error(`Missing Tailwind color ${name}`);
  const [lightness, chroma, hue] = body.split(/\s+/);
  if (lightness === undefined || chroma === undefined || hue === undefined) {
    throw new Error(`Malformed Tailwind color ${name}`);
  }
  const a = Number(chroma) * Math.cos((Number(hue) * Math.PI) / 180);
  const b = Number(chroma) * Math.sin((Number(hue) * Math.PI) / 180);
  const L = parseFloat(lightness) / 100;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gamma = (channel: number) => {
    const clamped = Math.min(1, Math.max(0, channel));
    return Math.round(
      (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255,
    );
  };
  return [gamma(red), gamma(green), gamma(blue)];
}

function pair(className: string, appearance: "light" | "dark"): { ink: string; surface: string } {
  const pattern =
    appearance === "light"
      ? /bg-([a-z]+)-(\d+)\s+text-\1-(\d+)/
      : /dark:bg-([a-z]+)-(\d+)\s+dark:text-\1-(\d+)/;
  const match = className.match(pattern);
  if (!match) throw new Error(`Could not read ${appearance} monogram shades from ${className}`);
  return {
    surface: `${match[1]}-${match[2]}`,
    ink: `${match[1]}-${match[3]}`,
  };
}

describe("ProjectMonogram solid tiles", () => {
  it("clears WCAG AA on every built-in theme and appearance", () => {
    const ratios = THEME_APPEARANCES.map((combo) => {
      const appearance = combo.endsWith("/dark") ? "dark" : "light";
      let minimum = Number.POSITIVE_INFINITY;
      let weakest = "";
      for (const color of PROJECT_ICON_COLORS) {
        const className = projectMonogramClassName(color.value);
        const shades = pair(className, appearance);
        const ratio = contrastRatio(oklch(shades.ink), oklch(shades.surface));
        if (ratio < minimum) {
          minimum = ratio;
          weakest = color.value;
        }
      }
      return { combo, minimum, weakest };
    });

    for (const entry of ratios) {
      expect(entry.weakest, entry.combo).not.toBe("");
      expect(entry.minimum, `${entry.combo} ${entry.weakest}`).toBeGreaterThanOrEqual(4.5);
      expect(entry.minimum, entry.combo).toBeLessThan(21);
    }
    // The tile is opaque, so the page theme cannot lower the ratio. The floor
    // is the same in every light combo and every dark combo.
    expect(
      new Set(
        ratios.filter((entry) => entry.combo.endsWith("/light")).map((entry) => entry.minimum),
      ).size,
    ).toBe(1);
    expect(
      new Set(ratios.filter((entry) => entry.combo.endsWith("/dark")).map((entry) => entry.minimum))
        .size,
    ).toBe(1);
  });
});
