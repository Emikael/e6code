import { describe, expect, it } from "vite-plus/test";

import { parseTurnDiffFilesFromNumstat, parseTurnDiffFilesFromRawNumstat } from "./Diffs.ts";

describe("parseTurnDiffFilesFromNumstat", () => {
  it("returns an empty list when no files changed", () => {
    expect(parseTurnDiffFilesFromNumstat("")).toEqual([]);
  });

  it("sorts files and preserves addition and deletion counts", () => {
    const numstat = ["0\t2\tsrc/b.ts", "2\t1\ta.txt", ""].join("\0");
    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
      { path: "a.txt", additions: 2, deletions: 1 },
      { path: "src/b.ts", additions: 0, deletions: 2 },
    ]);
  });

  it("uses destination paths for renames and copies", () => {
    const numstat = [
      "0\t0\t",
      "src/old.ts",
      "src/new.ts",
      "2\t1\t",
      "src/source.ts",
      "src/copied.ts",
      "1\t0\tother.ts",
      "",
    ].join("\0");

    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
      { path: "other.ts", additions: 1, deletions: 0 },
      { path: "src/copied.ts", additions: 2, deletions: 1 },
      { path: "src/new.ts", additions: 0, deletions: 0 },
    ]);
  });

  it("keeps binary files and empty files with zero line changes", () => {
    const numstat = ["-\t-\timage.png", "0\t0\tempty.txt", ""].join("\0");
    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
      { path: "empty.txt", additions: 0, deletions: 0 },
      { path: "image.png", additions: 0, deletions: 0 },
    ]);
  });

  it("preserves Unicode, tabs, line endings, and spaces in paths", () => {
    const path = " café\tline\r\nname.txt ";
    const numstat = `3\t2\t\0old\tname\n.txt\0${path}\0`;

    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([{ path, additions: 3, deletions: 2 }]);
    expect(parseTurnDiffFilesFromNumstat(`1\t0\t${path}\0`)).toEqual([
      { path, additions: 1, deletions: 0 },
    ]);
  });
});

describe("parseTurnDiffFilesFromRawNumstat", () => {
  it("gives each file the kind git reports, with its counts", () => {
    // Recorded from `git diff --raw --numstat -z` over an add, a delete, an edit and a rename.
    const output = [
      ":000000 100644 0000000 8ba3a16 A",
      "added.txt",
      ":100644 000000 587be6b 0000000 D",
      "gone.txt",
      ":100644 100644 28ce6a8 2ea3be2 M",
      "mod.txt",
      ":100644 100644 b414108 b414108 R100",
      "old.txt",
      "new.txt",
      "1\t0\tadded.txt",
      "0\t1\tgone.txt",
      "1\t0\tmod.txt",
      "0\t0\t",
      "old.txt",
      "new.txt",
      "",
    ].join("\0");
    expect(parseTurnDiffFilesFromRawNumstat(output)).toEqual([
      { path: "added.txt", kind: "added", additions: 1, deletions: 0 },
      { path: "gone.txt", kind: "deleted", additions: 0, deletions: 1 },
      { path: "mod.txt", kind: "modified", additions: 1, deletions: 0 },
      { path: "new.txt", kind: "renamed", additions: 0, deletions: 0 },
    ]);
  });

  it("returns an empty list when nothing changed", () => {
    expect(parseTurnDiffFilesFromRawNumstat("")).toEqual([]);
  });
});
