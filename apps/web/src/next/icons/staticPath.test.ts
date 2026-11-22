// @effect-diagnostics nodeBuiltinImport:off - walks the icon layer's import graph on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const ICONS_DIR = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const SRC_DIR = NodePath.resolve(ICONS_DIR, "../..");
const REPO_DIR = NodePath.resolve(SRC_DIR, "../../..");
const GENERATED_DIR = NodePath.join(ICONS_DIR, "generated");
const LAZY_DIR = NodePath.join(GENERATED_DIR, "lazy");
/** The string-keyed loader and its factory: the dynamic path. */
const DYNAMIC_MODULES = new Set([
  NodePath.join(ICONS_DIR, "Icon.tsx"),
  NodePath.join(ICONS_DIR, "dynamicIcon.tsx"),
]);

const DESIGN_TOKENS = "@e6tools/design-tokens";
const DESIGN_TOKENS_DIR = NodePath.join(REPO_DIR, "packages/design-tokens");
const designTokensPackage: { readonly exports: Record<string, { readonly import: string }> } =
  JSON.parse(NodeFS.readFileSync(NodePath.join(DESIGN_TOKENS_DIR, "package.json"), "utf8"));

/**
 * What a static icon may load besides the layer itself: React and the weight rule. Everything
 * else in design-tokens (the registry with every entry's meaning, project icons, custom artwork,
 * morphs, the Lucide table) would ride along on every route that draws an icon.
 */
const ALLOWED_PACKAGES = new Set(["react"]);
const ALLOWED_FILES = new Set([NodePath.join(DESIGN_TOKENS_DIR, "src/icons/weight.ts")]);

const isInside = (dir: string, file: string) => file.startsWith(dir + NodePath.sep);
const label = (file: string) => NodePath.relative(REPO_DIR, file);

/** Disk, with probe files laid over it (paths relative to this folder). */
const fileSource = (probes: Readonly<Record<string, string>> = {}) => {
  const overlay = new Map(
    Object.entries(probes).map(([path, text]) => [NodePath.join(ICONS_DIR, path), text]),
  );
  const isFile = (path: string) =>
    overlay.has(path) || NodeFS.statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  const list = (dir: string): string[] => [
    ...(NodeFS.existsSync(dir)
      ? NodeFS.readdirSync(dir, { recursive: true, encoding: "utf8" })
      : []
    )
      .map((path) => NodePath.join(dir, path))
      .filter((path) => !overlay.has(path) && isFile(path)),
    ...[...overlay.keys()].filter((path) => isInside(dir, path)),
  ];
  return {
    read: (path: string) =>
      overlay.get(path) ?? (isFile(path) ? NodeFS.readFileSync(path, "utf8") : undefined),
    /** A module path as the bundler finds it; a missing file keeps its path so checks still apply. */
    resolve: (path: string) =>
      [path, `${path}.ts`, `${path}.tsx`, NodePath.join(path, "index.ts")].find(isFile) ?? path,
    /** Every source module below `dir`, tests excluded. */
    modulesIn: (dir: string) => list(dir).filter((path) => /(?<!\.test)\.tsx?$/.test(path)),
  };
};
type FileSource = ReturnType<typeof fileSource>;

/** Drops comments, so a mention of an import is not one. Leaves `//` and `/*` inside strings. */
const stripComments = (text: string) =>
  text.replace(/(^|[\s;{}()])\/\*[\s\S]*?\*\//g, "$1").replace(/(^|[\s;{}()])\/\/.*$/gm, "$1");

/**
 * `import … from`, `export … from` (named, `*`, `* as`), bare `import "…"` and literal `import()`.
 * The clause cannot hold `;`, quotes, `(`, `)`, `=`, `<`, `>` or another `import` or `export`, so
 * it never spans two statements, even where a statement has no semicolon.
 */
const MODULE_REFERENCE =
  /\b(?:import|export)\s+(type\s+)?(?:(?!\b(?:import|export)\b)[^;'"()=<>])*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["'`]([^"'`$]+)["'`]\s*\)/g;

const referencesOf = (text: string) =>
  [...stripComments(text).matchAll(MODULE_REFERENCE)].map((match) => ({
    from: (match[2] ?? match[3] ?? match[4])!,
    // `import type` and `export type` carry no code. `import { type X }` counts as a value:
    // web compiles without verbatimModuleSyntax, so only the whole-clause form is certain.
    typeOnly: match[1] !== undefined,
    // `import()` is the lazy boundary itself, not part of the static path.
    dynamic: match[4] !== undefined,
  }));

type Target = { readonly file: string } | { readonly external: string };

const resolveReference = (importer: string, from: string, files: FileSource): Target => {
  if (from.startsWith(".")) {
    return { file: files.resolve(NodePath.resolve(NodePath.dirname(importer), from)) };
  }
  if (from.startsWith("~/"))
    return { file: files.resolve(NodePath.resolve(SRC_DIR, from.slice(2))) };
  if (from.startsWith(`${DESIGN_TOKENS}/`)) {
    const entry = designTokensPackage.exports[`.${from.slice(DESIGN_TOKENS.length)}`];
    if (entry !== undefined) return { file: NodePath.resolve(DESIGN_TOKENS_DIR, entry.import) };
  }
  return { external: from };
};

interface Walk {
  /** Each module the walk refused, why, and the chain of value imports that reached it. */
  readonly offences: ReadonlyArray<{ readonly target: string; readonly reason: string }>;
  readonly reached: ReadonlyArray<string>;
}

/**
 * Follows value imports from `roots`, transitively. `refuse` says why a module may not be
 * reached; the walk records it and does not descend into it.
 */
const walkValueImports = (
  roots: ReadonlyArray<string>,
  files: FileSource,
  refuse: (target: Target, text: string | undefined) => string | undefined,
): Walk => {
  const offences: Array<{ target: string; reason: string }> = [];
  const reached = new Set<string>();
  const queue = roots.map((file) => ({ file, chain: [label(file)] }));
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { file, chain } = next;
    if (reached.has(file)) continue;
    reached.add(file);
    const text = files.read(file);
    const reason = refuse({ file }, text === undefined ? undefined : stripComments(text));
    if (reason !== undefined) {
      offences.push({ target: label(file), reason: `${reason}, via ${chain.join(" -> ")}` });
      continue;
    }
    for (const { from, typeOnly, dynamic } of referencesOf(text ?? "")) {
      if (typeOnly || dynamic) continue;
      const target = resolveReference(file, from, files);
      if ("file" in target) {
        queue.push({ file: target.file, chain: [...chain, label(target.file)] });
        continue;
      }
      const external = refuse(target, undefined);
      if (external !== undefined) {
        offences.push({
          target: target.external,
          reason: `${external}, via ${chain.join(" -> ")}`,
        });
      }
    }
  }
  return { offences, reached: [...reached].map(label) };
};

/** Why a module may not be on the static path, which every route that draws an icon loads. */
const refuseOnStaticPath = (target: Target, text: string | undefined) => {
  if ("external" in target) {
    return ALLOWED_PACKAGES.has(target.external) ? undefined : "not React or the weight rule";
  }
  const { file } = target;
  if (DYNAMIC_MODULES.has(file) || isInside(LAZY_DIR, file)) return "the dynamic path";
  if (text !== undefined && /\bimport\.meta\.glob\b/.test(text)) return "an import.meta.glob";
  if (!isInside(ICONS_DIR, file) && !ALLOWED_FILES.has(file)) return "not React or the weight rule";
  return undefined;
};

/** Lazy modules are self-contained, so the dynamic graph never pulls in a static component. */
const refuseFromLazyModule = (target: Target) =>
  "file" in target && isInside(GENERATED_DIR, target.file) && !isInside(LAZY_DIR, target.file)
    ? "a static generated module"
    : undefined;

/** The static path: the entry, the primitive, the fixture and every static generated module. */
const staticRoots = (files: FileSource) => [
  NodePath.join(ICONS_DIR, "index.ts"),
  NodePath.join(ICONS_DIR, "IconSvg.tsx"),
  NodePath.join(ICONS_DIR, "testing/IconFolderFixture.tsx"),
  ...files.modulesIn(GENERATED_DIR).filter((file) => !isInside(LAZY_DIR, file)),
];

const probeStaticPath = (probes: Readonly<Record<string, string>>, root: string) =>
  walkValueImports([NodePath.join(ICONS_DIR, root)], fileSource(probes), refuseOnStaticPath)
    .offences;

const LAZY_GLOB = "./generated/lazy/*.tsx";
const GLOB_CALL =
  /\bimport\.meta\.glob(?:<[^>]*>)?\(\s*(["'`])([^"'`]*)\1\s*(?:,\s*(\{[^)]*\}))?\s*\)/g;

/**
 * What is wrong with how `Icon.tsx` globs the lazy folder. An eager glob would bundle every
 * icon into the loader's chunk; another folder would make the static components dynamic-import
 * targets, which splits every icon into its own chunk.
 */
const lazyGlobProblems = (text: string) => {
  const calls = [...stripComments(text).matchAll(GLOB_CALL)];
  if (calls.length !== 1) return [`expected one import.meta.glob, found ${calls.length}`];
  const [, , pattern, options] = calls[0]!;
  return [
    ...(pattern === LAZY_GLOB ? [] : [`globs ${pattern}`]),
    ...(options !== undefined && /\beager\b/.test(options) ? ["loads eagerly"] : []),
  ];
};

/** Web modules that import a lazy module statically, around the loader. */
const lazyModuleImporters = (files: FileSource) =>
  files
    .modulesIn(SRC_DIR)
    .filter((file) => !isInside(LAZY_DIR, file))
    .flatMap((file) =>
      referencesOf(files.read(file) ?? "")
        .filter(({ dynamic }) => !dynamic)
        .map(({ from }) => resolveReference(file, from, files))
        .filter((target) => "file" in target && isInside(LAZY_DIR, target.file))
        .map(() => label(file)),
    );

describe("icon layer static path", () => {
  it("loads only the layer, React and the weight rule", () => {
    const files = fileSource();
    const walk = walkValueImports(staticRoots(files), files, refuseOnStaticPath);
    expect(walk.offences).toEqual([]);
    // The walk must see the primitive reach the weight rule, or it proves nothing.
    expect(walk.reached).toEqual(
      expect.arrayContaining([
        "apps/web/src/next/icons/IconSvg.tsx",
        "packages/design-tokens/src/icons/weight.ts",
      ]),
    );
  });

  it("keeps every lazy module off the static generated modules", () => {
    const files = fileSource();
    expect(
      walkValueImports(files.modulesIn(LAZY_DIR), files, refuseFromLazyModule).offences,
    ).toEqual([]);
  });

  it("loads the lazy folder through one non-eager glob in Icon.tsx", () => {
    const source = fileSource().read(NodePath.join(ICONS_DIR, "Icon.tsx"));
    expect(source, "Icon.tsx").toBeDefined();
    expect(lazyGlobProblems(source ?? "")).toEqual([]);
  });

  it("is the only way into the lazy modules", () => {
    expect(lazyModuleImporters(fileSource())).toEqual([]);
  });

  it.each([
    [`import.meta.glob("${LAZY_GLOB}", { eager: true })`, ["loads eagerly"]],
    ['import.meta.glob("./generated/*.tsx")', ["globs ./generated/*.tsx"]],
    ["{}", ["expected one import.meta.glob, found 0"]],
  ])("catches a loader that globs wrongly: %s", (text, problems) => {
    expect(lazyGlobProblems(`export const Icon = createDynamicIcon(${text});`)).toEqual(problems);
  });

  it("catches a web module that imports a lazy module statically", () => {
    const probe = 'import { IconFolder } from "~/next/icons/generated/lazy/IconFolder.tsx";';
    expect(lazyModuleImporters(fileSource({ "../../routes/probe.tsx": probe }))).toEqual([
      "apps/web/src/routes/probe.tsx",
    ]);
  });

  // Probes: each shape that would put the registry or the loader on the static path is caught.
  it.each([
    [
      "a value import of the registry",
      { "generated/IconProbe.tsx": 'import { ICONS } from "@e6tools/design-tokens/icons";' },
      "packages/design-tokens/src/icons/registry.ts",
    ],
    [
      "a value import written with an inline type modifier",
      {
        "generated/IconProbe.tsx":
          'import { type IconName, ICONS } from "@e6tools/design-tokens/icons";',
      },
      "packages/design-tokens/src/icons/registry.ts",
    ],
    [
      "a value import after a type export with no semicolon",
      {
        "generated/IconProbe.tsx":
          'type Probe = 1\nexport type { Probe }\nimport { ICONS } from "@e6tools/design-tokens/icons"\nexport const count = Object.keys(ICONS).length',
      },
      "packages/design-tokens/src/icons/registry.ts",
    ],
    [
      "a re-export of the registry",
      { "generated/IconProbe.tsx": 'export { ICONS } from "@e6tools/design-tokens/icons";' },
      "packages/design-tokens/src/icons/registry.ts",
    ],
    [
      "a star re-export of a module that imports the registry",
      {
        "generated/IconProbe.tsx": 'export * from "./probeShared.ts";',
        "generated/probeShared.ts":
          'import { ICONS } from "@e6tools/design-tokens/icons";\nexport const count = Object.keys(ICONS).length;',
      },
      "packages/design-tokens/src/icons/registry.ts",
    ],
    [
      "a bare import of the registry",
      { "generated/IconProbe.tsx": 'import "@e6tools/design-tokens/icons";' },
      "packages/design-tokens/src/icons/registry.ts",
    ],
    [
      "a root importing the loader",
      { "probeRoot.ts": 'import { Icon } from "./Icon.tsx";\nexport { Icon };' },
      "apps/web/src/next/icons/Icon.tsx",
    ],
    [
      "an aliased import of the loader's factory",
      { "probeRoot.ts": 'import { createDynamicIcon } from "~/next/icons/dynamicIcon.tsx";' },
      "apps/web/src/next/icons/dynamicIcon.tsx",
    ],
    [
      "a static import of a lazy module",
      { "probeRoot.ts": 'import { IconFolder } from "./generated/lazy/IconFolder.tsx";' },
      "apps/web/src/next/icons/generated/lazy/IconFolder.tsx",
    ],
    [
      "a module that globs",
      {
        "probeRoot.ts": 'import { all } from "./probeGlob.ts";',
        "probeGlob.ts": 'export const all = import.meta.glob("./generated/*.tsx");',
      },
      "apps/web/src/next/icons/probeGlob.ts",
    ],
    [
      "a legacy module",
      { "probeRoot.ts": 'import { cn } from "~/lib/utils";' },
      "apps/web/src/lib/utils.ts",
    ],
  ])("catches %s", (_shape, probes, target) => {
    const root = Object.keys(probes)[0]!;
    expect(probeStaticPath(probes, root).map((offence) => offence.target)).toEqual([target]);
  });

  it.each([
    ['import type { IconName } from "@e6tools/design-tokens/icons";'],
    ['export type { IconName } from "@e6tools/design-tokens/icons";'],
    ['export const load = () => void import("./Icon.tsx");'],
    ['// import { ICONS } from "@e6tools/design-tokens/icons";'],
    ['/* export { Icon } from "./Icon.tsx"; */'],
  ])("lets types, a lazy import and comments through: %s", (text) => {
    expect(probeStaticPath({ "probeRoot.ts": text }, "probeRoot.ts")).toEqual([]);
  });

  it("catches a lazy module that imports a static generated module", () => {
    const files = fileSource({
      "generated/lazy/IconProbe.tsx": 'import { IconX } from "../IconX.tsx";\nexport { IconX };',
    });
    const offences = walkValueImports(
      files.modulesIn(LAZY_DIR),
      files,
      refuseFromLazyModule,
    ).offences;
    expect(offences.map((offence) => offence.target)).toEqual([
      "apps/web/src/next/icons/generated/IconX.tsx",
    ]);
  });
});
