import type { FileDiffMetadata, SelectionSide } from "@pierre/diffs";

/** One file as the paging key sees it, in the order the diff body shows it. */
export interface DiffPagingFile {
  readonly path: string;
  /** Its changes (hunks); 0 for a file without any, such as a binary file. */
  readonly changeCount: number;
  readonly reviewed: boolean;
  /**
   * Its patch has not loaded (still to come, or withheld by the host), so its changes are
   * unknown. The key lands on it and asks for it, and never marks it.
   */
  readonly pending?: boolean;
  /** The reader has been on it: paged or scrolled to it. A file without changes needs this. */
  readonly visited?: boolean;
}

/**
 * What the paging key does next. `change` scrolls to a change (`changeIndex` null is the file's
 * start); `mark` marks a file reviewed and moves on to `next`, or stays when no file is left;
 * `done` means every file is reviewed.
 */
export type DiffPagingStep =
  | { readonly kind: "change"; readonly fileIndex: number; readonly changeIndex: number | null }
  | { readonly kind: "mark"; readonly fileIndex: number; readonly next: number | null }
  | { readonly kind: "done" };

/** The next file not reviewed after `from`, wrapping past the last file; null when none is. */
function nextUnreviewedFile(files: readonly DiffPagingFile[], from: number): number | null {
  for (let offset = 1; offset < files.length; offset += 1) {
    const index = (from + offset) % files.length;
    if (!files[index]!.reviewed) return index;
  }
  return null;
}

/** Where to land in a file: its first change not yet seen, else its last one. */
function landIn(file: DiffPagingFile, seen: number, fileIndex: number): DiffPagingStep {
  if (file.pending || file.changeCount === 0) {
    return { kind: "change", fileIndex, changeIndex: null };
  }
  return { kind: "change", fileIndex, changeIndex: Math.min(seen, file.changeCount - 1) };
}

/**
 * The paging key's next step from the current file. It pages through changes not yet seen; only
 * once the file's last change has been seen does it mark the file reviewed and move to the next
 * file not reviewed, wrapping at the end. `seenOf` counts a file's changes already in view.
 * A file without changes is marked only once the reader has been on it. A pending file is never
 * marked: the key lands on it, and once there moves on to the next file not reviewed.
 */
export function nextDiffStep(
  files: readonly DiffPagingFile[],
  currentIndex: number,
  seenOf: (path: string) => number,
): DiffPagingStep {
  if (files.length === 0) return { kind: "done" };
  const index = Math.min(Math.max(currentIndex, 0), files.length - 1);
  const file = files[index]!;
  if (!file.reviewed) {
    if (file.pending) {
      if (!file.visited) return { kind: "change", fileIndex: index, changeIndex: null };
      const next = nextUnreviewedFile(files, index);
      return landIn(files[next ?? index]!, seenOf(files[next ?? index]!.path), next ?? index);
    }
    if (file.changeCount === 0 && !file.visited) {
      return { kind: "change", fileIndex: index, changeIndex: null };
    }
    const seen = seenOf(file.path);
    if (seen < file.changeCount) return { kind: "change", fileIndex: index, changeIndex: seen };
    return { kind: "mark", fileIndex: index, next: nextUnreviewedFile(files, index) };
  }
  const next = nextUnreviewedFile(files, index);
  if (next === null) return { kind: "done" };
  return landIn(files[next]!, seenOf(files[next]!.path), next);
}

/** The step after marking `fileIndex` reviewed and moving to `next`. */
export function landAfterMark(
  files: readonly DiffPagingFile[],
  next: number,
  seenOf: (path: string) => number,
): DiffPagingStep {
  const file = files[next];
  return file ? landIn(file, seenOf(file.path), next) : { kind: "done" };
}

/** The primary button's words for a step. */
export function pagingStepLabel(step: DiffPagingStep): string | null {
  switch (step.kind) {
    case "change":
      return "Next change";
    case "mark":
      return step.next === null ? "Mark reviewed" : "Mark reviewed, next file";
    case "done":
      return null;
  }
}

/** "File 3 of 5 · 1 more change in this file". */
export function pagingPositionLabel(input: {
  readonly fileIndex: number;
  readonly fileCount: number;
  readonly changeCount: number;
  readonly seen: number;
  readonly reviewed: boolean;
}): string {
  const position = `File ${input.fileIndex + 1} of ${input.fileCount}`;
  const remaining = Math.max(0, input.changeCount - input.seen);
  const detail = input.reviewed
    ? "reviewed"
    : remaining === 0
      ? "end of this file"
      : `${remaining} more ${remaining === 1 ? "change" : "changes"} in this file`;
  return `${position} · ${detail}`;
}

/** "Reply with 1 comment". */
export function replyLabel(commentCount: number): string {
  return `Reply with ${commentCount} ${commentCount === 1 ? "comment" : "comments"}`;
}

/** The current rail row's caption: "change 1 of 2", once a file has more than one change. */
export function changeCaption(seen: number, changeCount: number): string | null {
  if (changeCount < 2 || seen < 1) return null;
  return `change ${Math.min(seen, changeCount)} of ${changeCount}`;
}

/** Where a change starts, for scrolling to it: its first line on the side it has lines on. */
export function changeStart(
  fileDiff: FileDiffMetadata,
  changeIndex: number,
): { readonly lineNumber: number; readonly side: SelectionSide } | null {
  const hunk = fileDiff.hunks[changeIndex];
  if (!hunk) return null;
  return hunk.additionCount > 0
    ? { lineNumber: hunk.additionStart, side: "additions" }
    : { lineNumber: hunk.deletionStart, side: "deletions" };
}

/** Where a change ends, for the "You stopped here" line below it. */
export function changeEnd(
  fileDiff: FileDiffMetadata,
  changeIndex: number,
): { readonly lineNumber: number; readonly side: SelectionSide } | null {
  const hunk = fileDiff.hunks[changeIndex];
  if (!hunk) return null;
  return hunk.additionCount > 0
    ? { lineNumber: hunk.additionStart + hunk.additionCount - 1, side: "additions" }
    : { lineNumber: hunk.deletionStart + Math.max(0, hunk.deletionCount - 1), side: "deletions" };
}
