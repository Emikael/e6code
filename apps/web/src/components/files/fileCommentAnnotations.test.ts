import { describe, expect, it } from "vite-plus/test";

import { buildFileReviewComment } from "~/reviewCommentContext";

import {
  fileCommentAnnotationsFromDraft,
  fileLinesText,
  rerangeFileComments,
  withFileSelectionBar,
  withoutFileSelectionBar,
} from "./fileCommentAnnotations";

describe("the selection bar under selected lines", () => {
  it("copies exactly the selected lines", () => {
    expect(fileLinesText("a\nb\nc\nd", 2, 3)).toBe("b\nc");
    expect(fileLinesText("a\nb", 2, 2)).toBe("b");
  });

  it("sits under the last line beside any comment there, and is never kept", () => {
    const comment = {
      lineNumber: 3,
      metadata: {
        entries: [{ id: "c1", kind: "comment" as const, startLine: 3, endLine: 3, text: "hi" }],
      },
    };
    const shown = withFileSelectionBar([comment], 2, 3);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.metadata.entries.map((entry) => entry.kind)).toEqual(["comment", "selection"]);
    expect(withoutFileSelectionBar(shown)).toEqual([comment]);
    expect(withoutFileSelectionBar(withFileSelectionBar([], 5, 7))).toEqual([]);
  });
});

describe("file comments drawn from the composer draft", () => {
  const contents = "one\ntwo\nthree\nfour\n";
  const comment = buildFileReviewComment({
    id: "c1",
    filePath: "src/a.ts",
    startLine: 2,
    endLine: 2,
    text: "Rename this",
    contents,
  });
  // What the editor hands back on a keystroke: every card it was drawn with, moved down a line.
  const typedAbove = (annotations: ReturnType<typeof fileCommentAnnotationsFromDraft>) =>
    annotations.map((annotation) => ({
      lineNumber: annotation.lineNumber + 1,
      metadata: {
        entries: annotation.metadata.entries.map((entry) => ({
          ...entry,
          startLine: entry.startLine + 1,
          endLine: entry.endLine + 1,
        })),
      },
    }));

  it("draws a card for each comment in the composer on this file, and for open forms", () => {
    const draft = { id: "d1", kind: "draft" as const, startLine: 4, endLine: 4, text: "" };
    const shown = fileCommentAnnotationsFromDraft([comment], "src/a.ts", [draft]);
    expect(shown.map((annotation) => annotation.lineNumber)).toEqual([2, 4]);
    expect(fileCommentAnnotationsFromDraft([comment], "src/b.ts", [])).toEqual([]);
  });

  it("follows a comment still in the composer when lines move", () => {
    const shown = fileCommentAnnotationsFromDraft([comment], "src/a.ts", []);
    const moved = rerangeFileComments(
      [comment],
      "src/a.ts",
      typedAbove(shown),
      `zero\n${contents}`,
    );
    expect(moved?.[0]).toMatchObject({ id: "c1", startIndex: 2, endIndex: 2, diff: "two" });
  });

  it("does not attach a comment again after it was removed from the composer", () => {
    const stale = typedAbove(fileCommentAnnotationsFromDraft([comment], "src/a.ts", []));
    // Removed: the draft no longer holds it, and the next keystroke leaves it out.
    expect(rerangeFileComments([], "src/a.ts", stale, `zero\n${contents}`)).toBeNull();
    expect(fileCommentAnnotationsFromDraft([], "src/a.ts", [])).toEqual([]);
  });

  it("does not attach a comment again after the message was sent", () => {
    const other = { ...comment, id: "c2", sectionId: "turn:1:src/b.ts", filePath: "src/b.ts" };
    const stale = typedAbove(fileCommentAnnotationsFromDraft([comment], "src/a.ts", []));
    // Sending empties the draft; a later comment elsewhere is left as it was.
    expect(rerangeFileComments([other], "src/a.ts", stale, `zero\n${contents}`)).toBeNull();
  });
});
