import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { diffSinceReview, hunkFingerprints } from "./diffSinceReview.logic";

function parse(lines: string[], key: string) {
  const [file] = parsePatchFiles(
    ["diff --git a/src/app.ts b/src/app.ts", "--- a/src/app.ts", "+++ b/src/app.ts", ...lines].join(
      "\n",
    ),
    key,
  )[0]!.files;
  return file!;
}

// Reviewed with one change near the top.
const reviewed = parse(["@@ -1,3 +1,3 @@", " one", "-two", "+TWO", " three"], "reviewed");
// Since then the agent added a line above it and a change further down.
const current = parse(
  [
    "@@ -1,3 +1,4 @@",
    "+zero",
    " one",
    "-two",
    "+TWO",
    " three",
    "@@ -20,3 +21,3 @@",
    " twenty",
    "-old",
    "+new",
    " twenty-two",
  ],
  "current",
);

describe("hunkFingerprints", () => {
  it("tells changes apart by what they remove and add", () => {
    const [first, second] = hunkFingerprints(current);
    expect(first).not.toBe(second);
  });

  it("keeps a change's fingerprint when it only moves", () => {
    const moved = parse(["@@ -11,3 +11,3 @@", " one", "-two", "+TWO", " three"], "moved");
    expect(hunkFingerprints(moved)).toEqual(hunkFingerprints(reviewed));
  });
});

describe("diffSinceReview", () => {
  it("leaves out changes the file had when it was reviewed", () => {
    const later = parse(
      [
        "@@ -1,3 +1,3 @@",
        " one",
        "-two",
        "+TWO",
        " three",
        "@@ -20,3 +20,3 @@",
        " twenty",
        "-old",
        "+new",
        " twenty-two",
      ],
      "later",
    );
    const result = diffSinceReview(later, hunkFingerprints(reviewed));
    expect(result?.hiddenCount).toBe(1);
    expect(result?.fileDiff.hunks).toHaveLength(1);
    const [kept] = result!.fileDiff.hunks;
    expect(kept!.additionStart).toBe(20);
    // The dropped change's lines join the unchanged lines before the kept one.
    expect(kept!.collapsedBefore).toBe(later.hunks[1]!.collapsedBefore + 3);
    expect(kept!.unifiedLineStart).toBe(0);
    expect(result!.fileDiff.unifiedLineCount).toBe(kept!.unifiedLineCount);
  });

  it("counts a change that grew since review as new", () => {
    // The first change now also adds "zero", so it is a different change.
    expect(diffSinceReview(current, hunkFingerprints(reviewed))).toBeNull();
  });

  it("offers nothing when every change is new or none is", () => {
    expect(diffSinceReview(current, [])).toBeNull();
    expect(diffSinceReview(current, hunkFingerprints(current))).toBeNull();
  });
});
