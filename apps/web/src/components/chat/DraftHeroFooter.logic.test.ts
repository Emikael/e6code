import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { selectPickUpThreads, selectUnpushedCommits } from "./DraftHeroFooter.logic";

function shell(
  id: string,
  overrides: Partial<
    Pick<
      EnvironmentThreadShell,
      "hasPendingApprovals" | "hasPendingUserInput" | "archivedAt" | "snoozedUntil" | "updatedAt"
    >
  >,
): EnvironmentThreadShell {
  return {
    id,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    archivedAt: null,
    snoozedUntil: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

const nowMs = Date.parse("2026-11-01T12:00:00.000Z");

describe("selectPickUpThreads", () => {
  it("lists approvals before questions, newest first, and skips threads not waiting on you", () => {
    const picked = selectPickUpThreads(
      [
        shell("idle", {}),
        shell("old-question", { hasPendingUserInput: true, updatedAt: "2026-11-01T09:00:00.000Z" }),
        shell("new-question", { hasPendingUserInput: true, updatedAt: "2026-11-01T11:00:00.000Z" }),
        shell("approval", { hasPendingApprovals: true, updatedAt: "2026-11-01T08:00:00.000Z" }),
      ],
      { limit: 3, nowMs },
    );
    expect(picked.map((entry) => [String(entry.thread.id), entry.reason])).toEqual([
      ["approval", "approval"],
      ["new-question", "input"],
      ["old-question", "input"],
    ]);
  });

  it("leaves out archived threads and threads snoozed into the future", () => {
    const picked = selectPickUpThreads(
      [
        shell("archived", { hasPendingApprovals: true, archivedAt: "2026-11-01T11:30:00.000Z" }),
        shell("snoozed", { hasPendingApprovals: true, snoozedUntil: "2026-11-02T09:00:00.000Z" }),
        shell("woke-up", { hasPendingApprovals: true, snoozedUntil: "2026-11-01T11:00:00.000Z" }),
      ],
      { limit: 3, nowMs },
    );
    expect(picked.map((entry) => String(entry.thread.id))).toEqual(["woke-up"]);
  });

  it("caps the list", () => {
    const threads = Array.from({ length: 5 }, (_, index) =>
      shell(`t${index}`, { hasPendingUserInput: true }),
    );
    expect(selectPickUpThreads(threads, { limit: 3, nowMs })).toHaveLength(3);
  });
});

describe("selectUnpushedCommits", () => {
  const status = {
    isRepo: true,
    refName: "main",
    hasPrimaryRemote: true,
    isDefaultRef: true,
    hasUpstream: true,
    aheadCount: 2,
    pr: null,
  } as const;

  it("counts commits ahead of the upstream", () => {
    expect(selectUnpushedCommits(status)).toEqual({
      count: 2,
      refName: "main",
      hasOpenPullRequest: false,
    });
    expect(selectUnpushedCommits({ ...status, aheadCount: 0 })).toBeNull();
  });

  it("counts a branch that was never pushed against the default branch", () => {
    const unpublished = {
      ...status,
      refName: "e6/share-links",
      isDefaultRef: false,
      hasUpstream: false,
      aheadCount: 0,
    };
    expect(selectUnpushedCommits({ ...unpublished, aheadOfDefaultCount: 3 })?.count).toBe(3);
    expect(selectUnpushedCommits(unpublished)).toBeNull();
  });

  it("has nothing to say without a remote, a branch or a repository", () => {
    expect(selectUnpushedCommits({ ...status, hasPrimaryRemote: false })).toBeNull();
    expect(selectUnpushedCommits({ ...status, refName: null })).toBeNull();
    expect(selectUnpushedCommits({ ...status, isRepo: false })).toBeNull();
    expect(selectUnpushedCommits(null)).toBeNull();
  });
});
