import { describe, expect, it } from "vite-plus/test";

import {
  changeCaption,
  landAfterMark,
  nextDiffStep,
  pagingPositionLabel,
  pagingStepLabel,
  replyLabel,
  scrolledCurrentPath,
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

  it("lands on a file without changes before it marks it", () => {
    // The first press lands on it, so nothing is marked that was never on screen.
    expect(nextDiffStep([file("logo.png", 0), file("b.ts", 1)], 0, seen({}))).toEqual({
      kind: "change",
      fileIndex: 0,
      changeIndex: null,
    });
    // Once landed on or scrolled into view, the next press marks it.
    const visited = [{ ...file("logo.png", 0), visited: true }, file("b.ts", 1)];
    expect(nextDiffStep(visited, 0, seen({}))).toEqual({ kind: "mark", fileIndex: 0, next: 1 });
  });

  it("lands on a pending file and never marks it", () => {
    const pending = { ...file("big.ts", 0), pending: true };
    expect(nextDiffStep([pending, file("b.ts", 1)], 0, seen({}))).toEqual({
      kind: "change",
      fileIndex: 0,
      changeIndex: null,
    });
    // Still pending once landed on (loading, or withheld by the host): move on, unmarked.
    expect(nextDiffStep([{ ...pending, visited: true }, file("b.ts", 1)], 0, seen({}))).toEqual({
      kind: "change",
      fileIndex: 1,
      changeIndex: 0,
    });
    // The only file left not reviewed: stay on it rather than mark it or call the review done.
    expect(
      nextDiffStep([{ ...pending, visited: true }, file("b.ts", 1, true)], 0, seen({})),
    ).toEqual({ kind: "change", fileIndex: 0, changeIndex: null });
  });

  it("lands on a pending file after marking the one before it", () => {
    const files = [file("a.ts", 1), { ...file("big.ts", 0), pending: true }];
    expect(nextDiffStep(files, 0, seen({ "a.ts": 1 }))).toEqual({
      kind: "mark",
      fileIndex: 0,
      next: 1,
    });
    expect(landAfterMark(files, 1, seen({}))).toEqual({
      kind: "change",
      fileIndex: 1,
      changeIndex: null,
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

describe("scrolledCurrentPath", () => {
  const placed = [
    { path: "a.ts", top: 0, bottom: 400 },
    { path: "b.ts", top: 400, bottom: 500 },
    { path: "c.ts", top: 500, bottom: 560 },
  ];

  it("keeps the reader's file while it is in view, though it cannot reach the top", () => {
    expect(scrolledCurrentPath(placed, 100, 600, "c.ts")).toBe("c.ts");
  });

  it("moves to the first file in view once the reader's file has scrolled away", () => {
    expect(scrolledCurrentPath(placed, 420, 100, "a.ts")).toBe("b.ts");
  });

  it("starts from the first file in view", () => {
    expect(scrolledCurrentPath(placed, 0, 600, null)).toBe("a.ts");
  });
});
