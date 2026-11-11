import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, type ProjectScript } from "@e6tools/contracts";
import { projectScriptHash } from "@e6tools/shared/projectScripts";
import { describe, expect, it } from "vite-plus/test";

import {
  selectPickUpThreads,
  selectStaleSetupThread,
  selectUnpushedCommits,
} from "./DraftHeroFooter.logic";

const thread = (id: string) => ({ id }) as unknown as EnvironmentThreadShell;
const item = (id: string, kind: "approval" | "input" | "failed") => ({
  key: `local:${id}`,
  thread: thread(id),
  kind,
  tier: "blocked" as const,
  since: "2026-11-01T10:00:00.000Z",
});

describe("selectPickUpThreads", () => {
  it("offers approvals and questions in Needs you order, earlier ones last, up to the limit", () => {
    const picked = selectPickUpThreads(
      {
        blocked: [
          item("approval", "approval"),
          item("question", "input"),
          item("broken", "failed"),
        ],
        earlier: [item("stale", "approval"), item("extra", "input")],
      },
      3,
    );
    expect(picked.map((entry) => [String(entry.thread.id), entry.reason])).toEqual([
      ["approval", "approval"],
      ["question", "input"],
      ["stale", "approval"],
    ]);
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

describe("selectStaleSetupThread", () => {
  const environmentId = EnvironmentId.make("env-1");
  const projectId = ProjectId.make("project-1");
  const setup: ProjectScript = {
    id: "setup",
    name: "Setup worktree",
    command: "pnpm install",
    icon: "configure",
    runOnWorktreeCreate: true,
  };
  const project = { environmentId, id: projectId, scripts: [setup] };
  const oldHash = projectScriptHash({ command: "npm install" });
  const currentHash = projectScriptHash(setup);

  function worktreeThread(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      archivedAt: null,
      updatedAt: "2026-11-01T10:00:00.000Z",
      environmentId,
      projectId,
      branch: `e6code/${id}`,
      worktreePath: `/tmp/worktrees/${id}`,
      setupScriptHash: oldHash,
      ...overrides,
    } as unknown as EnvironmentThreadShell;
  }

  it("picks the newest worktree thread set up with an older setup script", () => {
    const stale = selectStaleSetupThread(
      [
        worktreeThread("older", { updatedAt: "2026-11-01T09:00:00.000Z" }),
        worktreeThread("newer", { updatedAt: "2026-11-01T11:00:00.000Z" }),
        worktreeThread("current", {
          setupScriptHash: currentHash,
          updatedAt: "2026-11-01T11:30:00.000Z",
        }),
      ],
      project,
    );
    if (!stale) throw new Error("expected a stale setup thread");
    expect(String(stale.thread.id)).toBe("newer");
    expect(stale.branch).toBe("e6code/newer");
    // Dismissing records the current script, which takes the thread out of the list.
    expect(stale.currentHash).toBe(currentHash);
    const dismissed = { ...stale.thread, setupScriptHash: stale.currentHash };
    expect(selectStaleSetupThread([dismissed], project)).toBeNull();
  });

  it("has nothing to compare in the project folder, without a record, or without a setup script", () => {
    const threads = [
      worktreeThread("local", { worktreePath: null }),
      worktreeThread("never-recorded", { setupScriptHash: null }),
      worktreeThread("from-old-server", { setupScriptHash: undefined }),
    ];
    expect(selectStaleSetupThread(threads, project)).toBeNull();
    expect(selectStaleSetupThread([worktreeThread("t")], { ...project, scripts: [] })).toBeNull();
  });

  it("stays inside the draft's project and skips archived threads", () => {
    const threads = [
      worktreeThread("other-project", { projectId: ProjectId.make("project-2") }),
      worktreeThread("other-environment", { environmentId: EnvironmentId.make("env-2") }),
      worktreeThread("archived", { archivedAt: "2026-11-01T11:00:00.000Z" }),
    ];
    expect(selectStaleSetupThread(threads, project)).toBeNull();
    expect(selectStaleSetupThread(threads, null)).toBeNull();
  });
});
