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
  /** A lockfile, snapshot or build output, folded away by default. */
  readonly generated: boolean;
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

/** The rail's rows, in the order given, each with the folder it needs to be told apart. */
export function diffRailRows(files: readonly DiffRailFile[]): DiffRailRow[] {
  const parts = files.map((file) => splitPath(file.path));
  return files.map((file, index) => {
    const own = parts[index]!;
    const peers = parts
      .filter(
        (other, otherIndex) => otherIndex !== index && areNamesConfusable(own.name, other.name),
      )
      .map((other) => other.directories);
    return {
      ...file,
      name: own.name,
      folder: peers.length > 0 ? distinguishingFolder(own.directories, peers) : null,
      generated: diffFileTier(file.path) === "generated",
    };
  });
}

/** The rows on show, and how many generated files the fold hides. Order is kept. */
export function visibleRailRows(
  rows: readonly DiffRailRow[],
  showGenerated: boolean,
): { rows: DiffRailRow[]; generatedCount: number } {
  const generatedCount = rows.filter((row) => row.generated).length;
  return {
    rows: showGenerated ? [...rows] : rows.filter((row) => !row.generated),
    generatedCount,
  };
}

/** "1 file", "5 files". */
export function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** The fold's words: "1 generated file hidden", or "2 generated files shown" once opened. */
export function generatedFoldLabel(count: number, shown: boolean): string {
  return `${count} generated ${count === 1 ? "file" : "files"} ${shown ? "shown" : "hidden"}`;
}
