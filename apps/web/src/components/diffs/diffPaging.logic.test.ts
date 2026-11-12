import { describe, expect, it } from "vite-plus/test";

import {
  changeCaption,
  landAfterMark,
  nextDiffStep,
  pagingPositionLabel,
  pagingStepLabel,
  replyLabel,
  type DiffPagingFile,
} from "./diffPaging.logic";

const file = (path: string, changeCount: number, reviewed = false): DiffPagingFile => ({
  path,
  changeCount,
  reviewed,
});
const seen = (counts: Record<string, number>) => (path: string) => counts[path] ?? 0;

describe("nextDiffStep", () => {
  const files = [file("a.ts", 2), file("b.ts", 1), file("c.ts", 3)];

  it("pages to the next change not yet seen", () => {
    expect(nextDiffStep(files, 0, seen({}))).toEqual({
      kind: "change",
      fileIndex: 0,
      changeIndex: 0,
    });
    expect(nextDiffStep(files, 0, seen({ "a.ts": 1 }))).toEqual({
      kind: "change",
      fileIndex: 0,
      changeIndex: 1,
    });
  });

  it("marks the file and moves on only once its last change was seen", () => {
    expect(nextDiffStep(files, 0, seen({ "a.ts": 2 }))).toEqual({
      kind: "mark",
      fileIndex: 0,
      next: 1,
    });
    expect(landAfterMark(files, 1, seen({}))).toEqual({
      kind: "change",
      fileIndex: 1,
      changeIndex: 0,
    });
  });

  it("wraps from the last file to the first one not reviewed", () => {
    const wrapped = [file("a.ts", 1), file("b.ts", 1, true), file("c.ts", 1)];
    expect(nextDiffStep(wrapped, 2, seen({ "c.ts": 1 }))).toEqual({
      kind: "mark",
      fileIndex: 2,
      next: 0,
    });
  });

  it("from a reviewed file goes to the next one not reviewed", () => {
    const mixed = [file("a.ts", 2, true), file("b.ts", 2, true), file("c.ts", 2)];
    expect(nextDiffStep(mixed, 0, seen({ "c.ts": 1 }))).toEqual({
      kind: "change",
      fileIndex: 2,
      changeIndex: 1,
    });
  });

  it("with a single file marks it and then stays done", () => {
    const single = [file("a.ts", 1)];
    expect(nextDiffStep(single, 0, seen({ "a.ts": 1 }))).toEqual({
      kind: "mark",
      fileIndex: 0,
      next: null,
    });
    expect(nextDiffStep([file("a.ts", 1, true)], 0, seen({}))).toEqual({ kind: "done" });
  });

  it("marks a file without changes on the first press", () => {
    expect(nextDiffStep([file("logo.png", 0), file("b.ts", 1)], 0, seen({}))).toEqual({
      kind: "mark",
      fileIndex: 0,
      next: 1,
    });
  });
});

describe("labels", () => {
  it("names the step", () => {
    expect(pagingStepLabel({ kind: "change", fileIndex: 0, changeIndex: 0 })).toBe("Next change");
    expect(pagingStepLabel({ kind: "mark", fileIndex: 0, next: 1 })).toBe(
      "Mark reviewed, next file",
    );
    expect(pagingStepLabel({ kind: "mark", fileIndex: 0, next: null })).toBe("Mark reviewed");
  });

  it("says where the reader is", () => {
    expect(
      pagingPositionLabel({ fileIndex: 2, fileCount: 5, changeCount: 2, seen: 1, reviewed: false }),
    ).toBe("File 3 of 5 · 1 more change in this file");
    expect(
      pagingPositionLabel({ fileIndex: 0, fileCount: 1, changeCount: 2, seen: 2, reviewed: false }),
    ).toBe("File 1 of 1 · end of this file");
  });

  it("counts comments and changes", () => {
    expect(replyLabel(1)).toBe("Reply with 1 comment");
    expect(replyLabel(3)).toBe("Reply with 3 comments");
    expect(changeCaption(1, 2)).toBe("change 1 of 2");
    expect(changeCaption(1, 1)).toBeNull();
  });
});
