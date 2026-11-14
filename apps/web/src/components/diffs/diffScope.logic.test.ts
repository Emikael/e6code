import { describe, expect, it } from "vite-plus/test";

import { diffErrorReason, threadDiffCwd } from "./diffScope.logic";

describe("threadDiffCwd", () => {
  it("reads the thread's worktree before its project's root", () => {
    expect(threadDiffCwd({ worktreePath: "/w/feature", workspaceRoot: "/p" })).toBe("/w/feature");
  });

  it("falls back to the project's root for a thread without a worktree", () => {
    expect(threadDiffCwd({ worktreePath: null, workspaceRoot: "/p" })).toBe("/p");
    expect(threadDiffCwd({ worktreePath: "", workspaceRoot: "/p" })).toBe("/p");
  });

  it("has no folder, and so no diff, when the thread has neither", () => {
    expect(threadDiffCwd({ worktreePath: undefined, workspaceRoot: undefined })).toBeNull();
  });
});

describe("diffErrorReason", () => {
  it("says a refused folder in the user's terms", () => {
    expect(
      diffErrorReason(
        "VCS repository detection failed in ReviewService.getDiffPreview: /p - Review diff preview cwd must stay within the configured workspace root.",
      ),
    ).toBe("This server only reads diffs inside the folder it was started in and its worktrees");
  });

  it("passes other failures through", () => {
    expect(diffErrorReason("Request timed out.")).toBe("Request timed out.");
  });
});
