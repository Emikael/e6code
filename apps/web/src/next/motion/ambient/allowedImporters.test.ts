// @effect-diagnostics nodeBuiltinImport:off - scans the source tree on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const AMBIENT_DIR = NodeURL.fileURLToPath(new URL(".", import.meta.url));
const SRC_DIR = NodePath.resolve(AMBIENT_DIR, "../../..");

/**
 * Files outside this folder allowed to import the ambient light, and the names each may use.
 * D12: `AmbientLight` only on the welcome wizard and pairing (E11); `AmbientStatic` only on
 * zero-projects. Never behind a working screen. E11 and E01-T16 add their files here.
 */
const ALLOWED_IMPORTERS: Readonly<Record<string, ReadonlyArray<string>>> = {};

const sourceFiles = (dir: string): string[] =>
  NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const IMPORT =
  /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const importsOf = (file: string) =>
  [...NodeFS.readFileSync(file, "utf8").matchAll(IMPORT)].map((match) => ({
    typeOnly: match[1] !== undefined,
    names: (match[2] ?? "")
      .replace(/[{}]/g, "")
      .split(",")
      .map(
        (name) =>
          name
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]!,
      )
      .filter(Boolean),
    from: match[3] ?? match[4]!,
  }));

const resolvesIntoAmbient = (file: string, specifier: string) => {
  if (specifier.startsWith("~/")) {
    return NodePath.resolve(SRC_DIR, specifier.slice(2)).startsWith(NodePath.resolve(AMBIENT_DIR));
  }
  if (specifier.startsWith(".")) {
    return NodePath.resolve(NodePath.dirname(file), specifier).startsWith(
      NodePath.resolve(AMBIENT_DIR),
    );
  }
  return false;
};

describe("ambient light importers", () => {
  it("is imported only from allow-listed surfaces, with allow-listed names", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      if (file.startsWith(NodePath.resolve(AMBIENT_DIR))) continue;
      const relative = NodePath.relative(SRC_DIR, file);
      for (const { names, from } of importsOf(file)) {
        if (!resolvesIntoAmbient(file, from)) continue;
        const allowed = ALLOWED_IMPORTERS[relative];
        const refused = allowed === undefined ? names : names.filter((n) => !allowed.includes(n));
        if (allowed === undefined || refused.length > 0) {
          offenders.push(`${relative}: ${refused.join(", ") || from}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the WebGL core out of everything but the lazy chunk", () => {
    const lazy = new Set(["liveCanvas.ts", "colorProbe.ts"]);
    const lazyModules = new Set([
      "@e6tools/shared/ambientLight",
      "./liveCanvas.ts",
      "./colorProbe.ts",
    ]);
    const eagerValueImports = sourceFiles(AMBIENT_DIR)
      .filter((file) => !lazy.has(NodePath.basename(file)))
      .flatMap((file) =>
        importsOf(file)
          .filter(({ typeOnly, names, from }) => {
            if (!lazyModules.has(from)) return false;
            // A dynamic import has no names; that is the lazy boundary itself.
            return !typeOnly && names.length > 0;
          })
          .map(({ from }) => `${NodePath.basename(file)} -> ${from}`),
      );
    expect(eagerValueImports).toEqual([]);
  });

  it("loads the renderer only through a dynamic import", () => {
    const source = NodeFS.readFileSync(NodePath.join(AMBIENT_DIR, "AmbientLight.tsx"), "utf8");
    expect(source).toMatch(/import\(\s*["']\.\/liveCanvas\.ts["']\s*\)/);
    expect(source).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']\.\/liveCanvas\.ts["']/);
  });
});
