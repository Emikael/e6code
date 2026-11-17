// @effect-diagnostics nodeBuiltinImport:off - scans the web sources the table must cover.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import pickerNames from "./fixtures/lucide-0.564.0-picker-names.json" with { type: "json" };
import {
  LUCIDE_TABLE,
  type LucideTableRow,
  MORPHS_BECOMING_ICON_SWAPS,
  PULL_REQUEST_GLYPH_ICON,
} from "./lucideTable.ts";
import { ICONS } from "./registry.ts";

/**
 * The table is the Lucide codemod's input (E03-T03), so it must hold every Lucide import the
 * web app has. This scans `apps/web/src` the way the codemod will: named imports from
 * `lucide-react` and `lucide`. When the codemod has run the scan finds nothing, and the table,
 * this test and the `./lucideIconTable` export are deleted together.
 */
const webSrc = new URL("../../../../apps/web/src/", import.meta.url).pathname;
const read = (file: string) => NodeFS.readFileSync(NodePath.join(webSrc, file), "utf8");

const sourceFiles: Array<string> = [];
(function walk(directory: string) {
  for (const item of NodeFS.readdirSync(directory, { withFileTypes: true })) {
    const path = NodePath.join(directory, item.name);
    if (item.isDirectory()) walk(path);
    else if (/\.tsx?$/.test(item.name)) sourceFiles.push(NodePath.relative(webSrc, path));
  }
})(webSrc);

const NOT_ICONS = new Set(["LucideIcon", "LucideProps", "IconNode", "createLucideIcon"]);

const imported = new Map<string, Set<string>>(); // "package:Specifier" -> files
for (const file of sourceFiles) {
  const source = read(file);
  for (const [, typeOnly, names, pkg] of source.matchAll(
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'](lucide-react|lucide)["']/g,
  )) {
    if (typeOnly) continue;
    for (const raw of names!.split(",")) {
      const specifier = raw
        .trim()
        .split(/\s+as\s+/)[0]!
        .trim();
      if (!specifier || specifier.startsWith("type ") || NOT_ICONS.has(specifier)) continue;
      const key = `${pkg}:${specifier}`;
      imported.set(key, (imported.get(key) ?? new Set()).add(file));
    }
  }
}

const rowsBySpecifier = new Map<string, LucideTableRow>(
  LUCIDE_TABLE.flatMap((row) =>
    row.specifiers.map((s) => [`${s.package}:${s.name}`, row] as const),
  ),
);

describe("Lucide icon table", () => {
  it("finds the imports it scans for", () => {
    expect(imported.size).toBeGreaterThan(200);
  });

  it("uses no import form the codemod cannot rewrite", () => {
    for (const file of sourceFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+["']lucide/);
      expect(source, file).not.toMatch(/export\s+[^;]*from\s+["']lucide/);
      expect(source, file).not.toMatch(/import\s+\w+\s*(?:,|from)[^;]*["']lucide/);
      expect(source, file).not.toMatch(/require\(\s*["']lucide/);
      for (const [, target] of source.matchAll(/from\s+["'](lucide[^"']*)["']/g)) {
        expect(["lucide", "lucide-react", "lucide-react/dynamic"], file).toContain(target);
      }
      for (const [, target] of source.matchAll(/import\(\s*["'](lucide[^"']*)["']\s*\)/g)) {
        expect(target, file).toBe("lucide-react/dynamic");
      }
    }
  });

  it("has a row for every Lucide icon the web app imports", () => {
    const missing = [...imported.keys()].filter((key) => !rowsBySpecifier.has(key));
    expect(missing, "add these specifiers to a row in lucideTable.ts").toEqual([]);
  });

  it("lists each specifier once and none the app no longer imports", () => {
    const listed = LUCIDE_TABLE.flatMap((row) =>
      row.specifiers.map((s) => `${s.package}:${s.name}`),
    );
    expect(new Set(listed).size).toBe(listed.length);
    expect(
      listed.filter((key) => !imported.has(key)),
      "the app no longer imports these; remove them from lucideTable.ts",
    ).toEqual([]);
  });

  it("keys each row by a Lucide 0.564.0 icon or a custom Lucide-style icon", () => {
    const lucide = new Set(Object.values(pickerNames));
    const keys = LUCIDE_TABLE.map((row) => row.lucide);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      if (key.startsWith("custom:")) continue;
      expect(lucide.has(key), key).toBe(true);
    }
    for (const custom of LUCIDE_TABLE.filter((row) => row.lucide.startsWith("custom:"))) {
      const id = custom.lucide.slice("custom:".length);
      expect(
        sourceFiles.some((file) => read(file).includes(`createLucideIcon("${id}"`)),
        id,
      ).toBe(true);
    }
  });

  it("names a registry entry for every row and override", () => {
    for (const row of LUCIDE_TABLE) {
      expect(ICONS, row.lucide).toHaveProperty(row.icon);
      for (const override of row.overrides ?? []) {
        expect(ICONS, `${row.lucide} in ${override.file}`).toHaveProperty(override.icon);
        expect(override.why.trim(), override.file).not.toBe("");
      }
    }
  });

  it("applies each override to a file that imports the row's icon", () => {
    for (const row of LUCIDE_TABLE) {
      for (const override of row.overrides ?? []) {
        const importers = row.specifiers.flatMap(
          (s) => [...(imported.get(`${s.package}:${s.name}`) ?? [])] as Array<string>,
        );
        expect(importers, `${row.lucide} override`).toContain(override.file);
      }
    }
  });

  // `lucide` (not `lucide-react`) exports raw IconNode data, which only MorphIcon draws.
  it("imports raw lucide icon data only where MorphIcon draws it", () => {
    for (const [key, files] of imported) {
      if (!key.startsWith("lucide:")) continue;
      for (const file of files) expect(read(file), file).toContain("MorphIcon");
    }
  });

  it("turns each dropped morph into a swap between two registry entries", () => {
    for (const swap of MORPHS_BECOMING_ICON_SWAPS) {
      expect(read(swap.file), swap.morph).toContain("<MorphIcon");
      for (const icon of swap.icons) expect(ICONS, swap.morph).toHaveProperty(icon);
    }
  });

  it("maps every pull-request glyph role to a registry entry", () => {
    const source = read("components/pullRequest/pullRequestIcons.tsx");
    const block = source.match(/export const PullRequestGlyph = \{([\s\S]*?)\} as const/)?.[1];
    const roles = [...(block ?? "").matchAll(/^\s+(\w+):/gm)].map((match) => match[1]!);
    expect(roles.length).toBeGreaterThan(5);
    expect(Object.keys(PULL_REQUEST_GLYPH_ICON).sort()).toEqual(roles.sort());
    for (const icon of Object.values(PULL_REQUEST_GLYPH_ICON)) expect(ICONS).toHaveProperty(icon);
  });
});
