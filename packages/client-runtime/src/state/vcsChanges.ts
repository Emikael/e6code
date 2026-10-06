import type { VcsFileChangeKind, VcsWorkingTreeFile } from "@e6tools/contracts";

export interface VcsChangeEntry {
  readonly path: string;
  readonly previousPath: string | null;
  readonly kind: VcsFileChangeKind;
  /** Null when the file also has changes in the other section, so the combined count would lie. */
  readonly stat: { readonly insertions: number; readonly deletions: number } | null;
  /** The file appears in both the staged and unstaged sections. */
  readonly mixed: boolean;
}

export interface VcsChangeSections {
  readonly conflicts: ReadonlyArray<VcsChangeEntry>;
  readonly staged: ReadonlyArray<VcsChangeEntry>;
  readonly unstaged: ReadonlyArray<VcsChangeEntry>;
  /** False for servers that report files without index state; staging is unavailable there. */
  readonly supported: boolean;
}

/** Groups working-tree files the way Git's index sees them: conflicts, staged, unstaged. */
export function deriveVcsChangeSections(
  files: ReadonlyArray<VcsWorkingTreeFile>,
): VcsChangeSections {
  const conflicts: VcsChangeEntry[] = [];
  const staged: VcsChangeEntry[] = [];
  const unstaged: VcsChangeEntry[] = [];
  let supported = files.length === 0;
  for (const file of files) {
    if (file.staged === undefined && file.unstaged === undefined) continue;
    supported = true;
    const mixed = file.staged !== undefined && file.unstaged !== undefined;
    const base = {
      path: file.path,
      previousPath: file.previousPath ?? null,
      stat: mixed ? null : { insertions: file.insertions, deletions: file.deletions },
      mixed,
    };
    if (file.unstaged === "conflicted") {
      conflicts.push({ ...base, kind: "conflicted" });
      continue;
    }
    if (file.staged !== undefined) staged.push({ ...base, kind: file.staged });
    if (file.unstaged !== undefined) unstaged.push({ ...base, kind: file.unstaged });
  }
  return { conflicts, staged, unstaged, supported };
}

const CHANGE_KIND_LETTERS: Record<VcsFileChangeKind, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "U",
  conflicted: "!",
};

const CHANGE_KIND_LABELS: Record<VcsFileChangeKind, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  "type-changed": "Type changed",
  untracked: "Untracked",
  conflicted: "Conflicted",
};

export const vcsChangeKindLetter = (kind: VcsFileChangeKind) => CHANGE_KIND_LETTERS[kind];
export const vcsChangeKindLabel = (kind: VcsFileChangeKind) => CHANGE_KIND_LABELS[kind];

/**
 * Paths to send when unstaging. A staged rename also stages its source deletion,
 * so both sides go back together.
 */
export function vcsUnstagePaths(entries: ReadonlyArray<VcsChangeEntry>): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    paths.add(entry.path);
    if (entry.kind === "renamed" && entry.previousPath) paths.add(entry.previousPath);
  }
  return [...paths];
}
