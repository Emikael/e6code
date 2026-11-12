import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";

import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

export interface FileCommentAnnotationEntry {
  id: string;
  /** "selection" is the bar under freshly selected lines: Copy, then Comment for the agent. */
  kind: "draft" | "comment" | "selection";
  startLine: number;
  endLine: number;
  text: string;
  /** Set while a saved comment is reopened for editing: what Cancel puts back. */
  savedText?: string;
}

export interface FileCommentAnnotationGroup {
  entries: FileCommentAnnotationEntry[];
}

export type FileCommentLineAnnotation = LineAnnotation<FileCommentAnnotationGroup>;

let fileCommentSequence = 0;

export function nextFileCommentId(): string {
  fileCommentSequence += 1;
  return `file-comment-${Date.now()}-${fileCommentSequence}`;
}

export function normalizeFileCommentRange(range: SelectedLineRange): {
  startLine: number;
  endLine: number;
} {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  };
}

/** "line 212" or "lines 212 to 214", for the saved comment card's heading. */
export function formatFileCommentLines(startLine: number, endLine: number): string {
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine} to ${endLine}`;
}

export function formatFileCommentRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`;
}

export function remapFileCommentAnnotations(
  annotations: ReadonlyArray<FileCommentLineAnnotation>,
): FileCommentLineAnnotation[] {
  return annotations.map((annotation) => ({
    ...annotation,
    metadata: {
      entries: annotation.metadata.entries.map((entry) => {
        const lineCount = entry.endLine - entry.startLine;
        return {
          ...entry,
          endLine: annotation.lineNumber,
          startLine: Math.max(1, annotation.lineNumber - lineCount),
        };
      }),
    },
  }));
}

/** The text of lines `startLine` to `endLine` (1-based, inclusive), for Copy on a selection. */
export function fileLinesText(contents: string, startLine: number, endLine: number): string {
  return contents
    .split("\n")
    .slice(Math.max(0, startLine - 1), Math.max(0, endLine))
    .join("\n");
}

/** The annotations with the selection bar placed under the selection's last line. */
export function withFileSelectionBar(
  annotations: ReadonlyArray<FileCommentLineAnnotation>,
  startLine: number,
  endLine: number,
): FileCommentLineAnnotation[] {
  const entry: FileCommentAnnotationEntry = {
    id: "file-selection-bar",
    kind: "selection",
    startLine,
    endLine,
    text: "",
  };
  const index = annotations.findIndex((annotation) => annotation.lineNumber === endLine);
  if (index < 0) return [...annotations, { lineNumber: endLine, metadata: { entries: [entry] } }];
  return annotations.map((annotation, at) =>
    at === index
      ? { ...annotation, metadata: { entries: [...annotation.metadata.entries, entry] } }
      : annotation,
  );
}

/** Drops the selection bar, which is never saved with the file's comments. */
export function withoutFileSelectionBar(
  annotations: ReadonlyArray<FileCommentLineAnnotation>,
): FileCommentLineAnnotation[] {
  return annotations.flatMap((annotation) => {
    const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "selection");
    return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
  });
}

/** The comments on one file in the Files tab are those whose section names it. */
function isCommentOnFile(comment: ReviewCommentContext, relativePath: string): boolean {
  return comment.sectionId === `file:${relativePath}`;
}

/**
 * The open file's comment cards. Saved comments are drawn from the composer draft, the one
 * ledger of what goes with the next message, so a comment removed there or sent leaves the file
 * too. `drafts` are the reader's open forms: a new comment, or a saved one reopened by Edit.
 */
export function fileCommentAnnotationsFromDraft(
  comments: ReadonlyArray<ReviewCommentContext>,
  relativePath: string,
  drafts: ReadonlyArray<FileCommentAnnotationEntry>,
): FileCommentLineAnnotation[] {
  const draftsById = new Map(drafts.map((entry) => [entry.id, entry]));
  const entries: FileCommentAnnotationEntry[] = [];
  const savedIds = new Set<string>();
  for (const comment of comments) {
    if (!isCommentOnFile(comment, relativePath)) continue;
    savedIds.add(comment.id);
    entries.push(
      draftsById.get(comment.id) ?? {
        id: comment.id,
        kind: "comment",
        startLine: comment.startIndex + 1,
        endLine: comment.endIndex + 1,
        text: comment.text,
      },
    );
  }
  // A reopened comment that left the composer meanwhile is gone; a new one is not saved yet.
  for (const draft of drafts) {
    if (!savedIds.has(draft.id) && draft.savedText === undefined) entries.push(draft);
  }
  const byLine = new Map<number, FileCommentAnnotationEntry[]>();
  for (const entry of entries) {
    const line = byLine.get(entry.endLine);
    if (line) line.push(entry);
    else byLine.set(entry.endLine, [entry]);
  }
  return [...byLine].map(([lineNumber, lineEntries]) => ({
    lineNumber,
    metadata: { entries: lineEntries },
  }));
}

/**
 * After an edit moved lines, the comments still in the composer follow their lines and quote
 * them afresh. Only comments already there are touched: an edit never attaches one again.
 * Returns null when nothing changed.
 */
export function rerangeFileComments(
  comments: ReadonlyArray<ReviewCommentContext>,
  relativePath: string,
  annotations: ReadonlyArray<FileCommentLineAnnotation>,
  contents: string,
): ReviewCommentContext[] | null {
  const moved = new Map<string, FileCommentAnnotationEntry>();
  for (const annotation of annotations) {
    for (const entry of annotation.metadata.entries) {
      if (entry.kind === "comment") moved.set(entry.id, entry);
    }
  }
  let changed = false;
  const next = comments.map((comment) => {
    const entry = moved.get(comment.id);
    if (entry === undefined || !isCommentOnFile(comment, relativePath)) return comment;
    const reranged = buildFileReviewComment({
      id: comment.id,
      filePath: relativePath,
      startLine: entry.startLine,
      endLine: entry.endLine,
      text: comment.text,
      contents,
    });
    if (
      reranged.startIndex === comment.startIndex &&
      reranged.endIndex === comment.endIndex &&
      reranged.diff === comment.diff
    ) {
      return comment;
    }
    changed = true;
    return { ...comment, ...reranged };
  });
  return changed ? next : null;
}

/** The reader's open forms follow their lines too. Returns `drafts` when nothing moved. */
export function rerangeFileCommentDrafts(
  drafts: ReadonlyArray<FileCommentAnnotationEntry>,
  annotations: ReadonlyArray<FileCommentLineAnnotation>,
): ReadonlyArray<FileCommentAnnotationEntry> {
  const moved = new Map<string, FileCommentAnnotationEntry>();
  for (const annotation of annotations) {
    for (const entry of annotation.metadata.entries) moved.set(entry.id, entry);
  }
  let changed = false;
  const next = drafts.map((draft) => {
    const entry = moved.get(draft.id);
    if (!entry || (entry.startLine === draft.startLine && entry.endLine === draft.endLine)) {
      return draft;
    }
    changed = true;
    return { ...draft, startLine: entry.startLine, endLine: entry.endLine };
  });
  return changed ? next : drafts;
}
