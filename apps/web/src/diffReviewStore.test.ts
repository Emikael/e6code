import { describe, expect, it } from "vite-plus/test";

import {
  diffReviewKey,
  diffReviewStatus,
  withDiffReviewMark,
  withoutDiffReviewThread,
  type DiffReviewFingerprint,
} from "./diffReviewStore";

const fingerprint = (overrides: Partial<DiffReviewFingerprint> = {}): DiffReviewFingerprint => ({
  objects: "a1..b2",
  counts: "4:1",
  ignoreWhitespace: false,
  ...overrides,
});
const mark = (overrides: Partial<DiffReviewFingerprint> = {}, at = 0) => ({
  ...fingerprint(overrides),
  at,
});

describe("diffReviewStatus", () => {
  it("holds while the file is unchanged", () => {
    expect(diffReviewStatus(mark(), fingerprint())).toBe("reviewed");
  });

  it("clears when the agent changes the file again", () => {
    expect(diffReviewStatus(mark(), fingerprint({ objects: "a1..c3", counts: "6:1" }))).toBe(
      "changed",
    );
  });

  it("is not cleared by the whitespace setting", () => {
    // Hiding whitespace changes the counts, never the blob ids.
    expect(diffReviewStatus(mark(), fingerprint({ counts: "2:0", ignoreWhitespace: true }))).toBe(
      "reviewed",
    );
    // Without blob ids, counts from the other setting say nothing.
    expect(
      diffReviewStatus(
        mark({ objects: null }),
        fingerprint({ objects: null, counts: "2:0", ignoreWhitespace: true }),
      ),
    ).toBe("reviewed");
  });

  it("falls back to counts while the patch has not loaded", () => {
    expect(diffReviewStatus(mark(), fingerprint({ objects: null }))).toBe("reviewed");
    expect(diffReviewStatus(mark(), fingerprint({ objects: null, counts: "5:1" }))).toBe("changed");
  });

  it("is unreviewed without a mark", () => {
    expect(diffReviewStatus(undefined, fingerprint())).toBe("unreviewed");
  });
});

describe("marks", () => {
  it("drops the oldest marks past the cap", () => {
    let marks = {};
    for (let index = 0; index < 4; index += 1) {
      marks = withDiffReviewMark(marks, `k${index}`, mark({}, index), 3);
    }
    expect(Object.keys(marks).toSorted()).toEqual(["k1", "k2", "k3"]);
  });

  it("forgets every mark of an archived thread and keeps the others", () => {
    const marks = {
      [diffReviewKey("env:t1", "uncommitted", "a.ts")]: mark(),
      [diffReviewKey("env:t1", "turn:1", "b.ts")]: mark(),
      [diffReviewKey("env:t10", "uncommitted", "a.ts")]: mark(),
    };
    expect(Object.keys(withoutDiffReviewThread(marks, "env:t1"))).toEqual([
      diffReviewKey("env:t10", "uncommitted", "a.ts"),
    ]);
  });
});
