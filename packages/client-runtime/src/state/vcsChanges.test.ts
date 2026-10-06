import { describe, expect, it } from "vite-plus/test";

import { deriveVcsChangeSections, vcsUnstagePaths } from "./vcsChanges.ts";

describe("deriveVcsChangeSections", () => {
  it("splits files by index state and hides counts for files in both sections", () => {
    const sections = deriveVcsChangeSections([
      { path: "a.ts", insertions: 3, deletions: 1, staged: "modified", unstaged: "modified" },
      { path: "b.ts", insertions: 2, deletions: 0, staged: "added" },
      { path: "c.ts", insertions: 0, deletions: 0, unstaged: "untracked" },
      { path: "d.ts", insertions: 0, deletions: 0, unstaged: "conflicted" },
    ]);

    expect(sections.supported).toBe(true);
    expect(sections.conflicts.map((entry) => entry.path)).toEqual(["d.ts"]);
    expect(sections.staged.map((entry) => [entry.path, entry.kind, entry.stat])).toEqual([
      ["a.ts", "modified", null],
      ["b.ts", "added", { insertions: 2, deletions: 0 }],
    ]);
    expect(sections.unstaged.map((entry) => [entry.path, entry.kind, entry.mixed])).toEqual([
      ["a.ts", "modified", true],
      ["c.ts", "untracked", false],
    ]);
  });

  it("reports staging as unsupported for servers without index state", () => {
    expect(deriveVcsChangeSections([{ path: "a.ts", insertions: 1, deletions: 0 }]).supported).toBe(
      false,
    );
    expect(deriveVcsChangeSections([]).supported).toBe(true);
  });

  it("unstages both sides of a staged rename", () => {
    const { staged } = deriveVcsChangeSections([
      { path: "new.ts", previousPath: "old.ts", insertions: 0, deletions: 0, staged: "renamed" },
      { path: "x.ts", insertions: 1, deletions: 0, staged: "modified" },
    ]);

    expect(vcsUnstagePaths(staged)).toEqual(["new.ts", "old.ts", "x.ts"]);
  });
});
