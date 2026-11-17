// @effect-diagnostics nodeBuiltinImport:off - reads mobile sources to check SF Symbol coverage.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { ENVIRONMENT_MACHINE_KINDS, ProjectScriptIcon } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CUSTOM_ICON_ARTWORK } from "./customArtwork.ts";
import phosphorNames from "./fixtures/phosphor-2.1.1-names.json" with { type: "json" };
import {
  ENVIRONMENT_MACHINE_ICON,
  ICON_WEIGHT_RULES,
  ICONS,
  type IconEntry,
  iconWeight,
  iconWeightsFor,
  PROJECT_SCRIPT_ICON,
} from "./registry.ts";

const PHOSPHOR = new Set<string>(phosphorNames);
const entries = Object.entries(ICONS) as Array<[string, IconEntry]>;
const repoPath = (path: string) => new URL(`../../../../${path}`, import.meta.url);

const PATH_ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

/** An SVG path whose every command carries whole sets of arguments. */
function isWellFormedPath(d: string): boolean {
  if (!/^\s*[Mm]/.test(d) || /[^\d\s,.eMLHVCSQTAZmlhvcsqtaz-]/.test(d)) return false;
  return [...d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)].every(([, letter, args]) => {
    const count = (args!.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? []).length;
    const arity = PATH_ARITY[letter!.toUpperCase()];
    return arity === undefined ? count === 0 : count > 0 && count % arity === 0;
  });
}

describe("icon registry", () => {
  it("names every entry in kebab-case, at most 64 characters, with a meaning", () => {
    for (const [name, entry] of entries) {
      expect(name, name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(name.length, name).toBeLessThanOrEqual(64);
      expect(entry.meaning.trim(), name).not.toBe("");
    }
  });

  it("draws every entry with Phosphor 2.1.1 artwork or custom paths for each weight", () => {
    const customIds = new Set<string>();
    for (const [name, entry] of entries) {
      const { artwork } = entry;
      if (artwork.source === "phosphor") {
        expect(PHOSPHOR.has(artwork.name), `${name} -> ${artwork.name}`).toBe(true);
        continue;
      }
      customIds.add(artwork.id);
      for (const source of artwork.derivedFrom) expect(PHOSPHOR.has(source), name).toBe(true);
      const paths: Partial<Record<string, string>> =
        CUSTOM_ICON_ARTWORK[artwork.id as keyof typeof CUSTOM_ICON_ARTWORK] ?? {};
      for (const weight of iconWeightsFor(entry)) {
        expect(isWellFormedPath(paths[weight] ?? ""), `${name} ${weight}`).toBe(true);
      }
    }
    expect(Object.keys(CUSTOM_ICON_ARTWORK).sort()).toEqual([...customIds].sort());
  });

  // Design direction 4.6: only universally understood controls may stand without text.
  it("exempts only close, add, more and the chevrons from the text-or-tooltip rule", () => {
    const exempt = entries.filter(([, entry]) => entry.pairing === "exempt").map(([name]) => name);
    expect(exempt.sort()).toEqual(
      [
        "add",
        "chevron-down",
        "chevron-left",
        "chevron-right",
        "chevron-up",
        "close",
        "more",
      ].sort(),
    );
  });
});

describe("iconWeight", () => {
  const fills = { ...ICONS.close, fillWhenActive: true, illustration: true } as const;
  const line = { ...ICONS.close, fillWhenActive: false } as const;

  it.each([
    ["rest at 16 px", fills, { sizePx: 16 }, "regular"],
    ["rest at 20 px", fills, { sizePx: 20 }, "regular"],
    ["rest at 14 px", fills, { sizePx: 14 }, "bold"],
    ["rest at 12 px", fills, { sizePx: 12 }, "bold"],
    ["active at 16 px", fills, { sizePx: 16, state: "active" }, "fill"],
    ["active at 12 px", fills, { sizePx: 12, state: "active" }, "fill"],
    ["active line glyph at 16 px", line, { sizePx: 16, state: "active" }, "regular"],
    ["active line glyph at 12 px", line, { sizePx: 12, state: "active" }, "bold"],
    ["illustration", fills, { sizePx: 48, illustration: true }, "duotone"],
    ["illustration request on a plain glyph", line, { sizePx: 48, illustration: true }, "regular"],
  ] as const)("%s", (_, entry, options, weight) => {
    expect(iconWeight(entry, options)).toBe(weight);
  });

  it("switches to bold at 14 px and below", () => {
    expect(ICON_WEIGHT_RULES.boldAtOrBelowPx).toBe(14);
  });

  // Phosphor's fill for these is a knock-out tile, not the glyph made solid.
  it("never fills artwork whose Phosphor fill is a knock-out tile", () => {
    const knockOut = new Set(["x", "plus", "check", "code", "terminal", "link"]);
    for (const [name, { artwork, fillWhenActive }] of entries) {
      if (artwork.source === "phosphor" && knockOut.has(artwork.name)) {
        expect(fillWhenActive, name).toBe(false);
      }
    }
  });

  it("never fills an entry whose fill is not its silhouette", () => {
    for (const [name, entry] of entries) {
      if (entry.fillWhenActive) continue;
      expect(iconWeight(entry, { sizePx: 16, state: "active" }), name).not.toBe("fill");
      expect(iconWeightsFor(entry), name).not.toContain("fill");
    }
  });
});

describe("persisted icon vocabularies", () => {
  it("draws every project script icon", () => {
    expect(Object.keys(PROJECT_SCRIPT_ICON).sort()).toEqual([...ProjectScriptIcon.literals].sort());
    for (const name of Object.values(PROJECT_SCRIPT_ICON)) expect(ICONS).toHaveProperty(name);
  });

  it("draws every environment machine kind", () => {
    expect(Object.keys(ENVIRONMENT_MACHINE_ICON).sort()).toEqual(
      [...ENVIRONMENT_MACHINE_KINDS].sort(),
    );
    for (const icon of Object.values(ENVIRONMENT_MACHINE_ICON)) {
      if (typeof icon === "string") expect(ICONS).toHaveProperty(icon);
    }
  });
});

/**
 * Every SF Symbol name mobile draws today must resolve to an entry, so AppSymbol can move to
 * semantic names (E01-T18) without losing a concept. When AppSymbol takes semantic names, this
 * test reads those instead.
 */
describe("mobile SF Symbol coverage", () => {
  const appSymbol = NodeFS.readFileSync(
    repoPath("apps/mobile/src/components/AppSymbol.tsx"),
    "utf8",
  );
  const sfMap = appSymbol.match(/const ANDROID_ICON_BY_SF_SYMBOL = \{([\s\S]*?)\} satisfies/)?.[1];
  const mapKeys = [...(sfMap ?? "").matchAll(/^\s+"?([a-z0-9.]+)"?: Icon\w+,/gm)].map(
    (match) => match[1]!,
  );

  const iosLiterals = new Set<string>();
  const walk = (directory: string) => {
    for (const item of NodeFS.readdirSync(directory, { withFileTypes: true })) {
      const path = NodePath.join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)) {
        // Object-form AppSymbol names, and SF Symbols in native header items.
        const source = NodeFS.readFileSync(path, "utf8");
        for (const match of source.matchAll(
          /\bios: "([a-z0-9.]+)"|\bname: "([a-z0-9.]+)", type: "sfSymbol"/g,
        )) {
          iosLiterals.add((match[1] ?? match[2])!);
        }
      }
    }
  };
  walk(repoPath("apps/mobile/src").pathname);

  const covered = new Set(
    entries.flatMap(([, { sf }]) => (sf ? [sf.regular, sf.fill, ...(sf.aliases ?? [])] : [])),
  );

  it("finds the names mobile draws", () => {
    expect(mapKeys.length).toBeGreaterThan(90);
    expect(iosLiterals.size).toBeGreaterThan(10);
  });

  it("maps every SF Symbol name mobile draws to an entry", () => {
    const missing = [...new Set([...mapKeys, ...iosLiterals])].filter((name) => !covered.has(name));
    expect(missing, "add these to an entry's sf in registry.ts").toEqual([]);
  });
});
