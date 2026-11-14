import type { FileDiffMetadata, Hunk } from "@pierre/diffs";

import { fnv1a32 } from "~/lib/diffRendering";

/**
 * What one change (hunk) says, apart from where it sits: its removed and added lines. A change
 * the agent left alone keeps its fingerprint when an edit elsewhere moves it down the file.
 */
export function hunkFingerprint(fileDiff: FileDiffMetadata, hunk: Hunk): string {
  const parts: string[] = [];
  for (const content of hunk.hunkContent) {
    if (content.type !== "change") continue;
    for (let offset = 0; offset < content.deletions; offset += 1) {
      parts.push(`-${fileDiff.deletionLines[content.deletionLineIndex + offset] ?? ""}`);
    }
    for (let offset = 0; offset < content.additions; offset += 1) {
      parts.push(`+${fileDiff.additionLines[content.additionLineIndex + offset] ?? ""}`);
    }
  }
  return fnv1a32(parts.join("\n")).toString(36);
}

export function hunkFingerprints(fileDiff: FileDiffMetadata): string[] {
  return fileDiff.hunks.map((hunk) => hunkFingerprint(fileDiff, hunk));
}

/**
 * The file with only the changes it did not have when it was marked reviewed. Changes it still
 * has from then fold into the unchanged lines around them. Null when there is nothing to leave
 * out, or nothing new to show, so the offer is made only when it narrows the file.
 */
export function diffSinceReview(
  fileDiff: FileDiffMetadata,
  reviewedHunks: ReadonlyArray<string>,
): { readonly fileDiff: FileDiffMetadata; readonly hiddenCount: number } | null {
  const reviewed = new Set(reviewedHunks);
  const kept: Hunk[] = [];
  // Lines of the new file that dropped changes leave between two kept ones.
  let foldedLines = 0;
  let splitLineStart = 0;
  let unifiedLineStart = 0;
  for (const hunk of fileDiff.hunks) {
    if (reviewed.has(hunkFingerprint(fileDiff, hunk))) {
      foldedLines += hunk.collapsedBefore + hunk.additionCount;
      continue;
    }
    kept.push({
      ...hunk,
      collapsedBefore: hunk.collapsedBefore + foldedLines,
      splitLineStart,
      unifiedLineStart,
    });
    foldedLines = 0;
    splitLineStart += hunk.splitLineCount;
    unifiedLineStart += hunk.unifiedLineCount;
  }
  const hiddenCount = fileDiff.hunks.length - kept.length;
  if (hiddenCount === 0 || kept.length === 0) return null;
  return {
    hiddenCount,
    fileDiff: {
      ...fileDiff,
      hunks: kept,
      // Rows are counted compactly, as for any patch read without the whole file.
      isPartial: true,
      splitLineCount: splitLineStart,
      unifiedLineCount: unifiedLineStart,
      ...(fileDiff.cacheKey ? { cacheKey: `${fileDiff.cacheKey}:since-review` } : {}),
    },
  };
}
