import { TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupChangedFilesByFolder,
  mergeThreadChangedFiles,
  recentFilesOutsideChanged,
  resolveFilesFilter,
  shortFileFolder,
} from "./threadChangedFiles";

const turn = (id: string, files: Array<[string, number, number]>, status = "ready") => ({
  turnId: TurnId.make(id),
  status,
  files: files.map(([path, additions, deletions]) => ({ path, additions, deletions })),
});

describe("mergeThreadChangedFiles", () => {
  // The project lives in apps/web of its repository.
  const toWorkspacePath = (path: string) =>
    path.startsWith("apps/web/") ? path.slice("apps/web/".length) : null;

  it("lists working-tree files as they stand and committed ones from their turns", () => {
    const files = mergeThreadChangedFiles({
      workingTree: [
        { path: "apps/web/src/index.css", insertions: 42, deletions: 7, unstaged: "modified" },
        { path: "apps/web/src/new.test.ts", insertions: 10, deletions: 0, unstaged: "untracked" },
        { path: "apps/web/src/gone.ts", insertions: 0, deletions: 9, unstaged: "deleted" },
        { path: "packages/shared/x.ts", insertions: 1, deletions: 1, unstaged: "modified" },
      ],
      checkpoints: [
        turn("t1", [
          ["apps/web/src/index.css", 5, 5],
          ["apps/web/src/theme.ts", 2, 1],
        ]),
        turn("t2", [["apps/web/src/theme.ts", 1, 0]]),
        turn("t3", [["apps/web/src/broken.ts", 1, 0]], "error"),
      ],
      toWorkspacePath,
    });
    expect(files).toEqual([
      {
        path: "src/index.css",
        repositoryPath: "apps/web/src/index.css",
        additions: 42,
        deletions: 7,
        isNew: false,
        diff: { kind: "working-tree" },
      },
      {
        path: "src/new.test.ts",
        repositoryPath: "apps/web/src/new.test.ts",
        additions: 10,
        deletions: 0,
        isNew: true,
        diff: { kind: "working-tree" },
      },
      {
        path: "src/theme.ts",
        repositoryPath: "apps/web/src/theme.ts",
        // The counts of the turn View diff opens, not a sum over turns.
        additions: 1,
        deletions: 0,
        isNew: false,
        diff: { kind: "turn", turnId: TurnId.make("t2") },
      },
    ]);
  });

  it("uses each turn's kind: an added file is new, a deleted one is gone", () => {
    const files = mergeThreadChangedFiles({
      workingTree: [],
      checkpoints: [
        {
          turnId: TurnId.make("t1"),
          status: "ready",
          files: [
            { path: "a.ts", kind: "added", additions: 4, deletions: 0 },
            { path: "b.ts", kind: "modified", additions: 1, deletions: 1 },
          ],
        },
        {
          turnId: TurnId.make("t2"),
          status: "ready",
          files: [
            { path: "a.ts", kind: "modified", additions: 2, deletions: 1 },
            { path: "b.ts", kind: "deleted", additions: 0, deletions: 9 },
          ],
        },
      ],
      toWorkspacePath: (path) => path,
    });
    expect(files).toEqual([
      {
        path: "a.ts",
        repositoryPath: "a.ts",
        additions: 2,
        deletions: 1,
        isNew: true,
        diff: { kind: "turn", turnId: TurnId.make("t2") },
      },
    ]);
  });

  it("groups by folder with root files first", () => {
    const files = mergeThreadChangedFiles({
      workingTree: [
        { path: "b/z.ts", insertions: 1, deletions: 0 },
        { path: "README.md", insertions: 1, deletions: 0 },
        { path: "a/y.ts", insertions: 1, deletions: 0 },
        { path: "b/x.ts", insertions: 1, deletions: 0 },
      ],
      checkpoints: [],
      toWorkspacePath: (path) => path,
    });
    expect(
      groupChangedFilesByFolder(files).map((group) => [
        group.folder,
        group.files.map((file) => file.path),
      ]),
    ).toEqual([
      ["", ["README.md"]],
      ["a", ["a/y.ts"]],
      ["b", ["b/x.ts", "b/z.ts"]],
    ]);
  });
});

describe("the Changed filter", () => {
  it("defaults to Changed when the thread has changes, then follows the reader", () => {
    expect(resolveFilesFilter({ stored: undefined, changedCount: 3 })).toBe("changed");
    expect(resolveFilesFilter({ stored: "all", changedCount: 3 })).toBe("all");
    expect(resolveFilesFilter({ stored: "changed", changedCount: 0 })).toBe("all");
  });

  it("leaves changed files out of Recently opened", () => {
    expect(
      recentFilesOutsideChanged(
        [
          { path: "a.ts", line: 3 },
          { path: "b.ts", line: null },
        ],
        [{ path: "a.ts" }],
        5,
      ),
    ).toEqual([{ path: "b.ts", line: null }]);
    // Cut after the filter, so changed files never leave Recently opened short.
    const recent = ["c1", "a", "c2", "b", "c", "d", "e", "f"].map((path) => ({ path }));
    expect(
      recentFilesOutsideChanged(recent, [{ path: "c1" }, { path: "c2" }], 5).map((f) => f.path),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("names where a recent file lives by its last two folders", () => {
    expect(shortFileFolder("packages/contracts/src/settings.ts")).toBe("contracts/src");
    expect(shortFileFolder("src/a.ts")).toBe("src");
    expect(shortFileFolder("AGENTS.md")).toBe("root");
  });
});
