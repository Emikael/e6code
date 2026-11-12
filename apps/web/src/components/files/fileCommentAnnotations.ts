import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";

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
