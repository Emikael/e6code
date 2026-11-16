// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet and font files from disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeZlib from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

const read = (path: string) => NodeFSP.readFile(new URL(path, import.meta.url));
const GEIST = "../node_modules/@fontsource-variable/geist/";

/** The uncompressed `cmap` table of a WOFF2 file (the table WOFF2 never transforms). */
function woff2Cmap(file: Uint8Array): DataView {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  expect(view.getUint32(0)).toBe(0x774f4632); // "wOF2"
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = file[at++]!;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("Invalid UIntBase128");
  };
  const tables: Array<{ tag: number; length: number }> = [];
  for (let i = 0; i < view.getUint16(12); i++) {
    const flags = file[at++]!;
    const tag = flags & 0x3f;
    if (tag === 63) at += 4; // Arbitrary tag; never cmap, which has known index 0.
    const transform = flags >> 6;
    const length = base128();
    // glyf (10) and loca (11) are transformed at version 0, every other table at non-zero.
    const transformed = tag === 10 || tag === 11 ? transform === 0 : transform !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = NodeZlib.brotliDecompressSync(file.subarray(at, at + view.getUint32(20)));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === 0) return new DataView(data.buffer, data.byteOffset + offset, table.length);
    offset += table.length;
  }
  throw new Error("No cmap table");
}

/** Code points with a glyph, from the Windows Unicode BMP (3, 1) format 4 subtable. */
function mappedCodePoints(cmap: DataView): Set<number> {
  const mapped = new Set<number>();
  for (let i = 0; i < cmap.getUint16(2); i++) {
    const record = 4 + i * 8;
    if (cmap.getUint16(record) !== 3 || cmap.getUint16(record + 2) !== 1) continue;
    const table = cmap.getUint32(record + 4);
    expect(cmap.getUint16(table)).toBe(4);
    const segments = cmap.getUint16(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const start = cmap.getUint16(starts + s * 2);
      const delta = cmap.getInt16(deltas + s * 2);
      const rangeOffset = cmap.getUint16(rangeOffsets + s * 2);
      for (let code = start; code <= cmap.getUint16(ends + s * 2) && code !== 0xffff; code++) {
        let glyph = code;
        if (rangeOffset !== 0) {
          glyph = cmap.getUint16(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2);
          if (glyph === 0) continue;
        }
        if ((glyph + delta) & 0xffff) mapped.add(code);
      }
    }
  }
  return mapped;
}

function unicodeRange(css: string, marker: string): Set<number> {
  const block = css.slice(css.indexOf(marker));
  const range = block.match(/unicode-range:([^;]+);/)![1]!;
  const codePoints = new Set<number>();
  for (const part of range.split(",")) {
    const [first, last = first] = part.trim().replace(/^U\+/, "").split("-");
    for (let code = Number.parseInt(first!, 16); code <= Number.parseInt(last!, 16); code++) {
      codePoints.add(code);
    }
  }
  return codePoints;
}

describe("Geist Fallback face", () => {
  // Wider, and characters Geist lacks would draw in resized Arial for good instead of falling
  // through to the system font; narrower, and preloaded text would shift when Geist swaps in.
  it("covers exactly what the preloaded Geist latin face draws", async () => {
    const glyphs = mappedCodePoints(
      woff2Cmap(await read(`${GEIST}files/geist-latin-wght-normal.woff2`)),
    );
    const latinFace = unicodeRange(
      String(await read(`${GEIST}index.css`)),
      "/* geist-latin-wght-normal */",
    );
    const drawn = [...glyphs].filter((code) => latinFace.has(code));
    expect(drawn.length).toBeGreaterThan(200);

    const fallback = unicodeRange(
      String(await read("../src/index.css")),
      'font-family: "Geist Fallback"',
    );
    expect([...fallback].filter((code) => !glyphs.has(code))).toEqual([]);
    expect([...fallback].sort((a, b) => a - b)).toEqual(drawn.sort((a, b) => a - b));
  });
});
