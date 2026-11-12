import { describe, expect, it } from "vite-plus/test";

import {
  diffReviewKey,
  diffReviewMarksByPath,
  diffReviewStatus,
  diffReviewStatusAcrossScopes,
  diffLastSeenKey,
  lastSeenChangeIndex,
  useDiffReviewStore,
  withDiffLastSeen,
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
  });

  it("compares counts across whitespace settings only through the raw counts", () => {
    // Marked in a Diff that hides whitespace, read by Run details from git status.
    const marked = mark({
      objects: "a1..b2",
      counts: "2:0",
      ignoreWhitespace: true,
      rawCounts: "4:1",
    });
    const runDetails = (counts: string) =>
      fingerprint({ objects: null, counts, ignoreWhitespace: false, rawCounts: counts });
    expect(diffReviewStatus(marked, runDetails("4:1"))).toBe("reviewed");
    expect(diffReviewStatus(marked, runDetails("6:1"))).toBe("changed");
    // Without raw counts on the mark nothing can be compared, so no tick.
    expect(diffReviewStatus({ ...marked, rawCounts: null }, runDetails("4:1"))).toBe("unreviewed");
  });

  it("is changed when the agent changes a file marked under the other setting", () => {
    const marked = mark({ ignoreWhitespace: false, rawCounts: "4:1" });
    expect(
      diffReviewStatus(
        marked,
        fingerprint({ objects: null, counts: "1:0", ignoreWhitespace: true, rawCounts: "7:2" }),
      ),
    ).toBe("changed");
  });

  it("falls back to counts under the same setting while the patch has not loaded", () => {
    expect(diffReviewStatus(mark(), fingerprint({ objects: null }))).toBe("reviewed");
    expect(diffReviewStatus(mark(), fingerprint({ objects: null, counts: "5:1" }))).toBe("changed");
    // Under the other setting, with nothing else to compare, it shows no tick.
    expect(
      diffReviewStatus(
        mark({ objects: null }),
        fingerprint({ objects: null, counts: "2:0", ignoreWhitespace: true }),
      ),
    ).toBe("unreviewed");
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

describe("undo of a mark", () => {
  it("puts back an earlier changed-since-review mark, with its changes, instead of clearing it", () => {
    const key = diffReviewKey("env:t1", "uncommitted", "a.ts");
    const earlier = { ...mark({ objects: "a1..old", hunks: ["h1", "h2"] }, 5) };
    useDiffReviewStore.setState({ marks: { [key]: earlier } });
    const before = useDiffReviewStore.getState().marks[key];
    useDiffReviewStore.getState().mark(key, fingerprint({ objects: "a1..new" }));
    useDiffReviewStore.getState().restoreMark(key, before);
    expect(useDiffReviewStore.getState().marks[key]).toEqual(earlier);
  });

  it("clears a mark that was not there before", () => {
    const key = diffReviewKey("env:t1", "uncommitted", "b.ts");
    useDiffReviewStore.setState({ marks: {} });
    useDiffReviewStore.getState().mark(key, fingerprint());
    useDiffReviewStore.getState().restoreMark(key, undefined);
    expect(useDiffReviewStore.getState().marks[key]).toBeUndefined();
  });
});

describe("last seen", () => {
  it("finds the change it stopped at after the agent adds one above it", () => {
    const position = { path: "a.ts", change: 0, hunk: "h1", at: "2026-11-11T10:00:00.000Z" };
    expect(lastSeenChangeIndex(position, ["h1", "h2"])).toBe(0);
    expect(lastSeenChangeIndex(position, ["h0", "h1", "h2"])).toBe(1);
  });

  it("is gone once that change is gone, or for a position without a fingerprint", () => {
    const position = { path: "a.ts", change: 1, hunk: "h1", at: "2026-11-11T10:00:00.000Z" };
    expect(lastSeenChangeIndex(position, ["h0", "h2"])).toBeNull();
    const { hunk: _hunk, ...withoutFingerprint } = position;
    expect(lastSeenChangeIndex(withoutFingerprint, ["h1"])).toBeNull();
  });

  it("keeps the newest positions past the cap and forgets an archived thread's", () => {
    let positions = {};
    for (let index = 0; index < 3; index += 1) {
      positions = withDiffLastSeen(
        positions,
        diffLastSeenKey(`env:t${index}`, "uncommitted"),
        { path: "a.ts", change: 0, at: `2026-11-11T10:0${index}:00.000Z` },
        2,
      );
    }
    expect(Object.keys(positions)).toEqual([
      diffLastSeenKey("env:t1", "uncommitted"),
      diffLastSeenKey("env:t2", "uncommitted"),
    ]);
    expect(Object.keys(withoutDiffReviewThread(positions, "env:t1"))).toEqual([
      diffLastSeenKey("env:t2", "uncommitted"),
    ]);
  });
});

describe("review across scopes", () => {
  const workingTree = fingerprint({ objects: null, counts: "4:1" });

  it("counts a mark made under Latest turn for the file Run details lists", () => {
    const marks = {
      [diffReviewKey("env:t1", "turn:3", "src/a.ts")]: mark({ objects: "a1..b2" }),
      [diffReviewKey("env:t10", "uncommitted", "src/b.ts")]: mark(),
    };
    const byPath = diffReviewMarksByPath(marks, "env:t1");
    expect([...byPath.keys()]).toEqual(["src/a.ts"]);
    expect(diffReviewStatusAcrossScopes(byPath.get("src/a.ts"), workingTree)).toBe("reviewed");
  });

  it("is reviewed when any scope proves the file unchanged", () => {
    const marks = [mark({ objects: null, counts: "9:9" }, 2), mark({ objects: null }, 1)];
    expect(diffReviewStatusAcrossScopes(marks, workingTree)).toBe("reviewed");
  });

  it("follows the newest mark when none proves the file unchanged", () => {
    const marks = [
      mark({ objects: null, counts: "9:9" }, 2),
      mark({ ignoreWhitespace: true, rawCounts: null }, 3),
    ];
    expect(diffReviewStatusAcrossScopes(marks, workingTree)).toBe("unreviewed");
    expect(diffReviewStatusAcrossScopes([marks[0]!], workingTree)).toBe("changed");
    expect(diffReviewStatusAcrossScopes(undefined, workingTree)).toBe("unreviewed");
  });
});
