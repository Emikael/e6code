import type { PreviewAnnotationPayload } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

import {
  attachedCountLabel,
  attachedGroups,
  fileCommentCount,
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
    expect(fileCommentCount([fileComment, diffComment], "src/a.ts")).toBe(1);
    expect(fileCommentCount([fileComment, diffComment], "src/b.ts")).toBe(0);
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
    expect(groups[1]?.items[0]?.label).toBe("Too faint");
    expect(
      attachedGroups({ reviewComments: [], previewAnnotations: [], terminalContexts: [] }),
    ).toEqual([]);
  });
});
