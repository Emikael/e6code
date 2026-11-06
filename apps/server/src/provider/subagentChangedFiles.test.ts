import { describe, expect, it } from "vite-plus/test";

import { claudeChangedFiles, codexChangedFiles } from "./subagentChangedFiles.ts";

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
