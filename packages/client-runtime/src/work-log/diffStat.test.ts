import { describe, expect, it } from "vite-plus/test";

import { mainAgentDiffStat } from "./diffStat.ts";

const payload = (changedFiles: unknown, extra: Record<string, unknown> = {}) => ({
  itemType: "file_change",
  status: "completed",
  changedFiles,
  ...extra,
});

describe("mainAgentDiffStat", () => {
  it("sums the counted files the row lists, matching relative and absolute paths", () => {
    const changedFiles = [
      { path: "/repo/src/a.ts", additions: 40, deletions: 2 },
      { path: "/repo/src/b.ts", additions: 8, deletions: 10 },
      { path: "/repo/src/c.ts", additions: 5, deletions: 0 },
    ];
    expect(mainAgentDiffStat(payload(changedFiles), ["/repo/src/a.ts", "src/b.ts"])).toEqual({
      additions: 48,
      deletions: 12,
    });
  });

  it("takes every counted file when the row lists none", () => {
    expect(mainAgentDiffStat(payload([{ path: "a.ts", additions: 1, deletions: 2 }]), [])).toEqual({
      additions: 1,
      deletions: 2,
    });
  });

  it("gives no stat when a listed file has no counts or no entry", () => {
    const changedFiles = [
      { path: "/repo/a.ts", additions: 1, deletions: 0 },
      { path: "/repo/b.ts" },
    ];
    expect(mainAgentDiffStat(payload(changedFiles), ["/repo/a.ts", "/repo/b.ts"])).toBeNull();
    expect(mainAgentDiffStat(payload(changedFiles), [])).toBeNull();
    expect(mainAgentDiffStat(payload(changedFiles), ["/repo/a.ts", "/repo/z.ts"])).toBeNull();
    // An uncounted file the row does not list does not hide the listed one.
    expect(mainAgentDiffStat(payload(changedFiles), ["/repo/a.ts"])).toEqual({
      additions: 1,
      deletions: 0,
    });
  });

  it("leaves subagent rows, missing payloads and empty changes alone", () => {
    const changedFiles = [{ path: "/repo/a.ts", additions: 1, deletions: 1 }];
    expect(mainAgentDiffStat(payload(changedFiles, { agentId: "task-1" }), [])).toBeNull();
    expect(mainAgentDiffStat(payload(undefined), [])).toBeNull();
    expect(mainAgentDiffStat(null, [])).toBeNull();
    expect(
      mainAgentDiffStat(payload([{ path: "/repo/a.ts", additions: 0, deletions: 0 }]), []),
    ).toBeNull();
  });

  it("does not match a path that only shares a suffix within a name", () => {
    expect(
      mainAgentDiffStat(payload([{ path: "/repo/xa.ts", additions: 1, deletions: 0 }]), ["a.ts"]),
    ).toBeNull();
  });
});
