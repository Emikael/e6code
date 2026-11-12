import type { TurnId, VcsWorkingTreeFile } from "@e6tools/contracts";

/** A file the thread has touched, as the Files tab's Changed filter lists it. */
export interface ThreadChangedFile {
  /** Workspace-relative, as the Files tab opens it. */
  readonly path: string;
  /** Repository-relative, as the Diff tab and the checkpoints name it. */
  readonly repositoryPath: string;
  readonly additions: number;
  readonly deletions: number;
  /** Added or untracked in the working tree: shown as "new" in place of counts. */
  readonly isNew: boolean;
  /**
   * Where its diff lives: the working tree while it has uncommitted changes, otherwise the latest
   * turn that changed it.
   */
  readonly diff:
    | { readonly kind: "working-tree" }
    | { readonly kind: "turn"; readonly turnId: TurnId };
}

interface CheckpointLike {
  readonly turnId: TurnId;
  readonly status: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    /** Git's word for the change ("added", "deleted", "renamed", "copied", "modified"…); older
     * servers send "modified" for every file, and a word this list does not know reads as modified. */
    readonly kind?: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
}

const NEW_KINDS = new Set(["added", "untracked"]);
// A copy's destination is a file the turn created.
const CHECKPOINT_NEW_KINDS = new Set(["added", "copied"]);

/**
 * Merges the working tree with the thread's checkpoints into the files the thread has touched.
 * A working-tree entry speaks for the file as it stands now. A file only in checkpoints (already
 * committed) shows the counts of the last turn that touched it, the turn View diff opens, and
 * "new" when a turn of this thread added it. A file whose last turn deleted it is left out, as are
 * deleted working-tree files: there is nothing to open. `toWorkspacePath` maps a repository path
 * into the workspace, or null for one outside it.
 */
export function mergeThreadChangedFiles(input: {
  readonly workingTree: ReadonlyArray<VcsWorkingTreeFile>;
  readonly checkpoints: ReadonlyArray<CheckpointLike>;
  readonly toWorkspacePath: (repositoryPath: string) => string | null;
}): ThreadChangedFile[] {
  const byPath = new Map<string, ThreadChangedFile>();
  // Oldest first, so the last turn to touch a file is the one its diff opens on.
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.status !== "ready") continue;
    for (const file of checkpoint.files) {
      const path = input.toWorkspacePath(file.path);
      if (path === null) continue;
      if (file.kind === "deleted") {
        byPath.delete(path);
        continue;
      }
      const previous = byPath.get(path);
      byPath.set(path, {
        path,
        repositoryPath: file.path,
        additions: file.additions,
        deletions: file.deletions,
        isNew: CHECKPOINT_NEW_KINDS.has(file.kind ?? "") || (previous?.isNew ?? false),
        diff: { kind: "turn", turnId: checkpoint.turnId },
      });
    }
  }
  for (const file of input.workingTree) {
    const path = input.toWorkspacePath(file.path);
    if (path === null) continue;
    if (file.unstaged === "deleted" || (file.staged === "deleted" && file.unstaged === undefined)) {
      byPath.delete(path);
      continue;
    }
    byPath.set(path, {
      path,
      repositoryPath: file.path,
      additions: file.insertions,
      deletions: file.deletions,
      isNew: NEW_KINDS.has(file.staged ?? "") || NEW_KINDS.has(file.unstaged ?? ""),
      diff: { kind: "working-tree" },
    });
  }
  return [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

/**
 * Workspace paths this thread's changes leave deleted: the last turn to touch them deleted them,
 * or the working tree has them deleted. The same reading as `mergeThreadChangedFiles`.
 */
export function deletedThreadFilePaths(input: {
  readonly workingTree: ReadonlyArray<VcsWorkingTreeFile>;
  readonly checkpoints: ReadonlyArray<CheckpointLike>;
  readonly toWorkspacePath: (repositoryPath: string) => string | null;
}): string[] {
  const deleted = new Set<string>();
  const mark = (path: string | null, isDeleted: boolean) => {
    if (path === null) return;
    if (isDeleted) deleted.add(path);
    else deleted.delete(path);
  };
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.status !== "ready") continue;
    for (const file of checkpoint.files) {
      mark(input.toWorkspacePath(file.path), file.kind === "deleted");
    }
  }
  for (const file of input.workingTree) {
    mark(
      input.toWorkspacePath(file.path),
      file.unstaged === "deleted" || (file.staged === "deleted" && file.unstaged === undefined),
    );
  }
  return [...deleted];
}

export interface ThreadChangedFolder {
  /** "" for files at the workspace root. */
  readonly folder: string;
  readonly files: ReadonlyArray<ThreadChangedFile>;
}

/** The parent folder of a workspace path, "" at the root. */
export function fileFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Board 15 groups changed files under their full folder path, each with a count. */
export function groupChangedFilesByFolder(
  files: ReadonlyArray<ThreadChangedFile>,
): ThreadChangedFolder[] {
  const groups = new Map<string, ThreadChangedFile[]>();
  for (const file of files) {
    const folder = fileFolder(file.path);
    const group = groups.get(folder);
    if (group) group.push(file);
    else groups.set(folder, [file]);
  }
  return [...groups.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([folder, groupFiles]) => ({ folder, files: groupFiles }));
}

export type FilesFilter = "all" | "changed";

/**
 * Which list the explorer shows. Changed is the first-time default when the thread has changes;
 * after that the reader's last choice holds. With nothing changed there is only All.
 */
export function resolveFilesFilter(input: {
  readonly stored: FilesFilter | undefined;
  readonly changedCount: number;
}): FilesFilter {
  if (input.changedCount === 0) return "all";
  return input.stored ?? "changed";
}

/** "Recently opened": the last `limit` files opened in this thread that are not in Changed. */
export function recentFilesOutsideChanged<T extends { readonly path: string }>(
  recent: ReadonlyArray<T>,
  changed: ReadonlyArray<{ readonly path: string }>,
  limit: number,
): T[] {
  const changedPaths = new Set(changed.map((file) => file.path));
  return recent.filter((file) => !changedPaths.has(file.path)).slice(0, limit);
}

/** The last two folders of a path, as "Recently opened" names where a file lives: "contracts/src". */
export function shortFileFolder(path: string): string {
  const folder = fileFolder(path);
  if (folder === "") return "root";
  return folder.split("/").slice(-2).join("/");
}
