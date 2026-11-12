import { diffFileTier } from "../pullRequest/pullRequestFileOrder.logic";

/** One changed file as the Diff tab's file rail lists it, in the order the diff body shows it. */
export interface DiffRailFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffRailRow extends DiffRailFile {
  readonly name: string;
  /**
   * The folder that tells this file from one whose name is easily confused with it
   * (`themePalettes.ts` beside `themePalette.ts`), else null.
   */
  readonly folder: string | null;
}

/** The panel width from which the rail starts open, when the user has not chosen. */
export const FILE_RAIL_OPEN_MIN_WIDTH = 720;

/** The rail is open when the user said so on this device, else when the panel is wide enough. */
export function isFileRailOpen(stored: boolean | null, panelWidth: number): boolean {
  return stored ?? panelWidth >= FILE_RAIL_OPEN_MIN_WIDTH;
}

function splitPath(path: string): { name: string; directories: string[] } {
  const segments = path.split("/");
  return { name: segments.at(-1) ?? path, directories: segments.slice(0, -1) };
}

/** Within one edit of each other, ignoring case: the same name, or one letter apart. */
export function areNamesConfusable(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * The folder nearest the file in which its path differs from every peer's, counted from the
 * file upward: `packages/shared/src/x.ts` against `apps/web/src/x.ts` gives `shared`. Null when
 * no single folder tells them apart, as for two files in the same folder.
 */
function distinguishingFolder(
  directories: readonly string[],
  peers: readonly string[][],
): string | null {
  for (let depth = 1; depth <= directories.length; depth += 1) {
    const segment = directories[directories.length - depth];
    if (segment === undefined) break;
    if (peers.every((peer) => peer[peer.length - depth] !== segment)) return segment;
  }
  return null;
}

/**
 * For each path, the folder it needs to be told from a file with an easily confused name, else
 * null. Linear in the number of files: names one edit apart share a key with one letter deleted,
 * so only files sharing a key are compared.
 */
export function railFolderHints(paths: readonly string[]): Map<string, string | null> {
  const parts = paths.map(splitPath);
  const byKey = new Map<string, number[]>();
  parts.forEach(({ name }, index) => {
    const lower = name.toLowerCase();
    const keys = new Set([lower]);
    for (let at = 0; at < lower.length; at += 1) keys.add(lower.slice(0, at) + lower.slice(at + 1));
    for (const key of keys) {
      const bucket = byKey.get(key);
      if (bucket) bucket.push(index);
      else byKey.set(key, [index]);
    }
  });
  const peersOf = new Map<number, Set<number>>();
  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    for (const index of bucket) {
      const peers = peersOf.get(index) ?? new Set<number>();
      for (const other of bucket) if (other !== index) peers.add(other);
      peersOf.set(index, peers);
    }
  }
  const hints = new Map<string, string | null>();
  paths.forEach((path, index) => {
    const own = parts[index]!;
    const peers = [...(peersOf.get(index) ?? [])]
      .filter((other) => areNamesConfusable(own.name, parts[other]!.name))
      .map((other) => parts[other]!.directories);
    hints.set(path, peers.length > 0 ? distinguishingFolder(own.directories, peers) : null);
  });
  return hints;
}

/**
 * The rail's rows, in the order given, each with the folder it needs to be told apart. Pass
 * `hints` from `railFolderHints` memoised on the path list, so new counts do not redo them.
 */
export function diffRailRows(
  files: readonly DiffRailFile[],
  hints: ReadonlyMap<string, string | null> = railFolderHints(files.map((file) => file.path)),
): DiffRailRow[] {
  return files.map((file) => ({
    ...file,
    name: splitPath(file.path).name,
    folder: hints.get(file.path) ?? null,
  }));
}

/**
 * What the Diff shows with generated files folded: the rail, the body and every count use the
 * same list, so "5 files" lists five. Order is kept; `shown` brings the folded files back.
 */
export function foldGeneratedFiles<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  shown: boolean,
): { items: T[]; generatedCount: number } {
  const isGenerated = (item: T) => diffFileTier(pathOf(item)) === "generated";
  return {
    items: shown ? [...items] : items.filter((item) => !isGenerated(item)),
    generatedCount: items.filter(isGenerated).length,
  };
}

/** How many of these files the Diff lists before its generated files are opened. */
export function listedDiffFileCount(files: ReadonlyArray<{ readonly path: string }>): number {
  return foldGeneratedFiles(files, (file) => file.path, false).items.length;
}

/** "1 file", "5 files". */
export function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** The fold's words: "1 generated file hidden", or "2 generated files shown" once opened. */
export function generatedFoldLabel(count: number, shown: boolean): string {
  return `${count} generated ${count === 1 ? "file" : "files"} ${shown ? "shown" : "hidden"}`;
}

/**
 * Entries in the order the diff body lists their paths, so a list beside the diff never
 * disagrees with it. Entries the diff does not show keep their own order, after the rest.
 */
export function inDiffOrder<T extends { readonly path: string }>(
  entries: readonly T[],
  order: readonly string[],
): T[] {
  const position = new Map(order.map((path, index) => [path, index]));
  const rank = (entry: T) => position.get(entry.path) ?? Number.POSITIVE_INFINITY;
  // A stable sort, so unknown entries stay as they came.
  return entries.toSorted((left, right) => {
    const a = rank(left);
    const b = rank(right);
    return a === b ? 0 : a < b ? -1 : 1;
  });
}
