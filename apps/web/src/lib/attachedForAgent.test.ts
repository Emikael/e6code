import type { PreviewAnnotationPayload } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

import {
  attachedCount,
  attachedCountLabel,
  attachedGroups,
  attachedNotSentLabel,
  unsentCodeCommentCount,
} from "./attachedForAgent";
import type { TerminalContextDraft } from "./terminalContext";

const fileComment = buildFileReviewComment({
  id: "file-1",
  filePath: "src/a.ts",
  startLine: 2,
  endLine: 3,
  text: "Rename this",
  contents: "one\ntwo\nthree\n",
});
const diffComment = {
  ...fileComment,
  id: "diff-1",
  sectionId: "turn:1:src/b.ts",
  filePath: "src/b.ts",
  rangeLabel: "+4",
  fenceLanguage: "diff",
} satisfies ReviewCommentContext;
const pullRequestComment = {
  ...diffComment,
  id: "pr-1",
  pullRequest: {} as NonNullable<ReviewCommentContext["pullRequest"]>,
} satisfies ReviewCommentContext;

describe("attached for the agent", () => {
  it("says attached, never queued, in the singular and plural", () => {
    expect(attachedCountLabel(1, "comment")).toBe("1 comment attached");
    expect(attachedCountLabel(2, "note")).toBe("2 notes attached");
    expect(attachedCountLabel(3, "terminal")).toBe("3 selections attached");
  });

  it("counts Diff and file comments as not sent, but not a pull request hand-off", () => {
    expect(unsentCodeCommentCount([fileComment, diffComment, pullRequestComment])).toBe(2);
  });

  it("counts each tab's kind from the same items the composer row shows", () => {
    const draft = {
      reviewComments: [fileComment, diffComment, pullRequestComment],
      previewAnnotations: [
        { id: "note-1", comment: "Too faint" } as PreviewAnnotationPayload,
        { id: "note-2", comment: "Wrong colour" } as PreviewAnnotationPayload,
      ],
      terminalContexts: [{ id: "term-1" } as TerminalContextDraft],
    };
    const groups = attachedGroups(draft);
    for (const kind of ["comment", "note", "terminal"] as const) {
      expect(attachedCount(draft, kind)).toBe(
        groups.find((group) => group.kind === kind)?.items.length ?? 0,
      );
    }
    expect(attachedCount(draft, "comment")).toBe(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["file-1", "diff-1"]);
    expect(groups[1]?.items.map((item) => item.label)).toEqual([
      "Note 1 · Too faint",
      "Note 2 · Wrong colour",
    ]);
    expect(attachedCount(null, "note")).toBe(0);
  });

  it("says what is not sent with the right count and word", () => {
    const empty = { reviewComments: [], previewAnnotations: [], terminalContexts: [] };
    expect(attachedNotSentLabel(empty)).toBeNull();
    expect(attachedNotSentLabel({ ...empty, reviewComments: [pullRequestComment] })).toBeNull();
    expect(attachedNotSentLabel({ ...empty, reviewComments: [fileComment] })).toBe(
      "1 comment not sent",
    );
    expect(
      attachedNotSentLabel({
        reviewComments: [fileComment, diffComment],
        previewAnnotations: [{ id: "n" } as PreviewAnnotationPayload],
        terminalContexts: [],
      }),
    ).toBe("2 comments and 1 note not sent");
    expect(
      attachedNotSentLabel({
        reviewComments: [fileComment],
        previewAnnotations: [{ id: "n" } as PreviewAnnotationPayload],
        terminalContexts: [
          { id: "t" } as TerminalContextDraft,
          { id: "u" } as TerminalContextDraft,
        ],
      }),
    ).toBe("1 comment, 1 note and 2 selections not sent");
  });

  it("groups the composer's chips by kind in a fixed order, leaving empty kinds out", () => {
    const note = { id: "note-1", comment: "Too faint" } as PreviewAnnotationPayload;
    const terminal = {
      id: "term-1",
      terminalId: "t",
      terminalLabel: "Terminal 1",
      lineStart: 3,
      lineEnd: 4,
      text: "x",
    } as TerminalContextDraft;
    const groups = attachedGroups({
      reviewComments: [fileComment],
      previewAnnotations: [note],
      terminalContexts: [terminal],
    });
    expect(groups.map((group) => [group.title, group.items.map((item) => item.id)])).toEqual([
      ["Comments", ["file-1"]],
      ["Browser notes", ["note-1"]],
      ["Terminal output", ["term-1"]],
    ]);
    expect(groups[1]?.items[0]?.label).toBe("Note 1 · Too faint");
    expect(
      attachedGroups({ reviewComments: [], previewAnnotations: [], terminalContexts: [] }),
    ).toEqual([]);
  });
});
