import { describe, expect, it } from "vite-plus/test";

import {
  acpChangedFiles,
  claudeChangedFiles,
  codexChangedFiles,
  openCodeChangedFiles,
} from "./subagentChangedFiles.ts";

describe("claudeChangedFiles", () => {
  it("diffs an edit's own strings when the SDK sent no patch", () => {
    expect(
      claudeChangedFiles(
        "MultiEdit",
        {
          file_path: "/repo/a.ts",
          edits: [
            { old_string: "keep\nold\n", new_string: "keep\nnew\nmore\n" },
            { old_string: "x\n", new_string: "" },
          ],
        },
        undefined,
      ),
    ).toEqual([{ path: "/repo/a.ts", additions: 2, deletions: 2 }]);
  });

  it("lists the file without counts when they cannot be known", () => {
    // replace_all edits an unknown number of sites; an overwrite has no patch.
    expect(
      claudeChangedFiles(
        "Edit",
        { file_path: "/repo/a.ts", old_string: "a", new_string: "b", replace_all: true },
        undefined,
      ),
    ).toEqual([{ path: "/repo/a.ts" }]);
    expect(
      claudeChangedFiles("Write", { file_path: "/repo/b.ts", content: "x\n" }, { type: "update" }),
    ).toEqual([{ path: "/repo/b.ts" }]);
  });

  it("ignores tools that change no file", () => {
    expect(claudeChangedFiles("Read", { file_path: "/repo/a.ts" }, undefined)).toBeUndefined();
  });
});

describe("codexChangedFiles", () => {
  it("names a renamed file by its new path and skips file headers", () => {
    expect(
      codexChangedFiles([
        {
          path: "/repo/old.ts",
          kind: { type: "update", move_path: "/repo/new.ts" },
          diff: "--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-a\n+b\n",
        },
      ]),
    ).toEqual([{ path: "/repo/new.ts", additions: 1, deletions: 1 }]);
  });
});

describe("openCodeChangedFiles", () => {
  it("diffs an edit's strings", () => {
    expect(
      openCodeChangedFiles("edit", {
        filePath: "/repo/a.ts",
        oldString: "one\ntwo\n",
        newString: "one\nthree\nfour\n",
      }),
    ).toEqual([{ path: "/repo/a.ts", additions: 2, deletions: 1 }]);
  });

  it("reads the snake_case spelling too", () => {
    expect(
      openCodeChangedFiles("edit", { file_path: "/repo/a.ts", old_string: "a", new_string: "b" }),
    ).toEqual([{ path: "/repo/a.ts", additions: 1, deletions: 1 }]);
  });

  it("lists the file without counts when the input cannot say", () => {
    expect(openCodeChangedFiles("write", { filePath: "/repo/b.ts", content: "x\n" })).toEqual([
      { path: "/repo/b.ts" },
    ]);
    expect(
      openCodeChangedFiles("edit", {
        filePath: "/repo/a.ts",
        oldString: "a",
        newString: "b",
        replaceAll: true,
      }),
    ).toEqual([{ path: "/repo/a.ts" }]);
    expect(openCodeChangedFiles("edit", undefined)).toBeUndefined();
  });
});

describe("acpChangedFiles", () => {
  it("counts created and edited files from diff content and skips other content", () => {
    expect(
      acpChangedFiles([
        { type: "content", content: { type: "text", text: "done" } },
        { type: "diff", path: "/repo/new.ts", newText: "a\nb\n" },
        { type: "diff", path: "/repo/old.ts", oldText: "a\nb\n", newText: "a\nc\n" },
      ]),
    ).toEqual([
      { path: "/repo/new.ts", additions: 2, deletions: 0 },
      { path: "/repo/old.ts", additions: 1, deletions: 1 },
    ]);
    expect(acpChangedFiles([{ type: "content" }])).toBeUndefined();
    expect(acpChangedFiles(undefined)).toBeUndefined();
  });

  it("keeps at most 64 files", () => {
    const content = Array.from({ length: 70 }, (_, index) => ({
      type: "diff",
      path: `/repo/${index}.ts`,
      newText: "x\n",
    }));
    expect(acpChangedFiles(content)).toHaveLength(64);
  });

  it("lists a rewrite too large or too different to diff without counts", () => {
    const lines = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => `${prefix}${index}\n`).join("");
    // Small enough to diff, but every line changed: past the edit-length bound.
    const rewritten = { oldText: lines("old", 3_000), newText: lines("new", 3_000) };
    // Few changes, but past the size bound.
    const huge = lines("same", 60_000);
    expect(
      acpChangedFiles([
        { type: "diff", path: "/repo/rewritten.ts", ...rewritten },
        { type: "diff", path: "/repo/huge.ts", oldText: huge, newText: `${huge}tail\n` },
        { type: "diff", path: "/repo/small.ts", oldText: "a\n", newText: "b\n" },
      ]),
    ).toEqual([
      { path: "/repo/rewritten.ts" },
      { path: "/repo/huge.ts" },
      { path: "/repo/small.ts", additions: 1, deletions: 1 },
    ]);
  });
});
