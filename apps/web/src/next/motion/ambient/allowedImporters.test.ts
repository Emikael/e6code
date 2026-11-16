// @effect-diagnostics nodeBuiltinImport:off - scans the source tree on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const AMBIENT_DIR = NodePath.resolve(NodeURL.fileURLToPath(new URL(".", import.meta.url)));
const SRC_DIR = NodePath.resolve(AMBIENT_DIR, "../../..");
/** The WebGL core. Only the lazy chunk in this folder may load it. */
const CORE = "@e6tools/shared/ambientLight";

/**
 * Files outside this folder allowed to import the ambient light, and the names each may use.
 * D12: `AmbientLight` only on the welcome wizard and pairing (E11); `AmbientStatic` only on
 * zero-projects. Never behind a working screen. E11 and E01-T16 add their files here.
 */
const ALLOWED_IMPORTERS: Readonly<Record<string, ReadonlyArray<string>>> = {};

interface Source {
  /** Absolute path. */
  readonly path: string;
  readonly text: string;
}

const sourceFiles = (dir: string): Source[] =>
  NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [{ path, text: NodeFS.readFileSync(path, "utf8") }]
      : [];
  });

/**
 * Static `import … from` and `export … from` (named, `*` and `* as`), and dynamic
 * `import("…")`. The clause stops at a semicolon so it never spans two statements.
 */
const MODULE_REFERENCE =
  /\b(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

const referencesOf = (text: string) =>
  [...text.matchAll(MODULE_REFERENCE)].map((match) => ({
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
  const target = specifier.startsWith("~/")
    ? NodePath.resolve(SRC_DIR, specifier.slice(2))
    : specifier.startsWith(".")
      ? NodePath.resolve(NodePath.dirname(file), specifier)
      : null;
  return (
    target !== null && (target === AMBIENT_DIR || target.startsWith(AMBIENT_DIR + NodePath.sep))
  );
};

/** Every reference outside this folder that breaks the allowlist or reaches the core. */
const offendersIn = (
  sources: ReadonlyArray<Source>,
  allowlist: Readonly<Record<string, ReadonlyArray<string>>>,
): string[] =>
  sources.flatMap(({ path, text }) => {
    if (path === AMBIENT_DIR || path.startsWith(AMBIENT_DIR + NodePath.sep)) return [];
    const relative = NodePath.relative(SRC_DIR, path);
    return referencesOf(text).flatMap(({ typeOnly, names, from }) => {
      // Types carry no code; any value reference to the core bypasses the gate.
      if (from === CORE) return typeOnly ? [] : [`${relative}: ${from}`];
      if (!resolvesIntoAmbient(path, from)) return [];
      const allowed = allowlist[relative];
      const refused = allowed === undefined ? names : names.filter((n) => !allowed.includes(n));
      return allowed === undefined || refused.length > 0
        ? [`${relative}: ${refused.join(", ") || from}`]
        : [];
    });
  });

const probe = (relative: string, text: string): Source => ({
  path: NodePath.join(SRC_DIR, relative),
  text,
});

describe("ambient light importers", () => {
  it("is imported only from allow-listed surfaces, with allow-listed names", () => {
    expect(offendersIn(sourceFiles(SRC_DIR), ALLOWED_IMPORTERS)).toEqual([]);
  });

  // Probes: each shape a mount could sneak through must be caught.
  it.each([
    ["an import", 'import { AmbientLight } from "~/next/motion/ambient";', "AmbientLight"],
    ["a named re-export", 'export { AmbientLight } from "~/next/motion/ambient";', "AmbientLight"],
    ["a star re-export", 'export * from "../next/motion/ambient";', "*"],
    ["a namespace re-export", 'export * as ambient from "../next/motion/ambient/index.ts";', "*"],
    ["a dynamic import", 'void import("~/next/motion/ambient");', "~/next/motion/ambient"],
    [
      "a deep import",
      'import { startLiveCanvas } from "~/next/motion/ambient/liveCanvas.ts";',
      "startLiveCanvas",
    ],
  ])("catches %s of the mount", (_shape, text, name) => {
    expect(offendersIn([probe("routes/probe.tsx", text)], {})).toEqual([
      `routes/probe.tsx: ${name}`,
    ]);
  });

  it.each([
    ['import { createAmbientLight } from "@e6tools/shared/ambientLight";'],
    ['export { createAmbientLight } from "@e6tools/shared/ambientLight";'],
    ['void import("@e6tools/shared/ambientLight");'],
  ])("catches a direct reference to the core: %s", (text) => {
    expect(offendersIn([probe("components/Probe.tsx", text)], {})).toEqual([
      "components/Probe.tsx: @e6tools/shared/ambientLight",
    ]);
  });

  it("lets an allow-listed file use only its names, and ignores type-only core imports", () => {
    const allowlist = { "routes/zero.tsx": ["AmbientStatic"] };
    const zero = 'import { AmbientStatic } from "~/next/motion/ambient";';
    const mixed = 'import { AmbientLight, AmbientStatic } from "~/next/motion/ambient";';
    expect(offendersIn([probe("routes/zero.tsx", zero)], allowlist)).toEqual([]);
    expect(offendersIn([probe("routes/zero.tsx", mixed)], allowlist)).toEqual([
      "routes/zero.tsx: AmbientLight",
    ]);
    const types = 'import type { AmbientColors } from "@e6tools/shared/ambientLight";';
    expect(offendersIn([probe("lib/types.ts", types)], {})).toEqual([]);
  });

  it("does not read a statement-spanning clause as an import", () => {
    const text = 'export const x = 1;\nimport { y } from "./elsewhere";';
    expect(referencesOf(text)).toEqual([{ typeOnly: false, names: ["y"], from: "./elsewhere" }]);
  });

  it("keeps the WebGL core out of everything but the lazy chunk", () => {
    const lazy = new Set(["liveCanvas.ts", "colorProbe.ts"]);
    const lazyModules = new Set([CORE, "./liveCanvas.ts", "./colorProbe.ts"]);
    const eagerValueImports = sourceFiles(AMBIENT_DIR)
      .filter(({ path }) => !lazy.has(NodePath.basename(path)))
      .flatMap(({ path, text }) =>
        referencesOf(text)
          .filter(({ typeOnly, names, from }) => {
            if (!lazyModules.has(from)) return false;
            // A dynamic import has no names; that is the lazy boundary itself.
            return !typeOnly && names.length > 0;
          })
          .map(({ from }) => `${NodePath.basename(path)} -> ${from}`),
      );
    expect(eagerValueImports).toEqual([]);
  });

  it("loads the renderer only through a dynamic import", () => {
    const source = NodeFS.readFileSync(NodePath.join(AMBIENT_DIR, "AmbientLight.tsx"), "utf8");
    expect(source).toMatch(/import\(\s*["']\.\/liveCanvas\.ts["']\s*\)/);
    expect(source).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']\.\/liveCanvas\.ts["']/);
  });
});
