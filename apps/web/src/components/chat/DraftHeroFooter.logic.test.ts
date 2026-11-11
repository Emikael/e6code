import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, type ProjectScript } from "@e6tools/contracts";
import { projectScriptHash } from "@e6tools/shared/projectScripts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatAttentionCue,
  needsYouHeading,
  planSegments,
  reviewCaption,
  selectStaleSetupThread,
  selectUnpushedCommits,
  selectWorkingThreads,
  workingCaption,
} from "./DraftHeroFooter.logic";

const thread = (id: string, overrides: Partial<EnvironmentThreadShell> = {}) =>
  ({
    id,
    environmentId: "local",
    archivedAt: null,
    session: null,
    ...overrides,
  }) as unknown as EnvironmentThreadShell;
const running = (status: "running" | "starting" | "ready") =>
  ({ status }) as EnvironmentThreadShell["session"];

describe("needsYouHeading", () => {
  it("counts blocked agents", () => {
    expect(needsYouHeading(1)).toBe("Needs you · 1 agent is blocked");
    expect(needsYouHeading(2)).toBe("Needs you · 2 agents are blocked");
  });
});

describe("formatAttentionCue", () => {
  it.each([
    ["asked", "4m", "asked 4m ago"],
    ["finished", "now", "finished just now"],
    ["ready", "since Tue", "ready Tue"],
    ["asked", "", ""],
  ])("%s with %s reads %s", (verb, age, cue) => {
    expect(formatAttentionCue(verb, age)).toBe(cue);
  });
});

describe("reviewCaption", () => {
  it("names plans and done turns, with line totals when there are any", () => {
    expect(reviewCaption("plan", { insertions: 3, deletions: 1 })).toBe("Plan ready");
    expect(reviewCaption("done", { insertions: 4, deletions: 4 })).toBe("Done · +4 −4");
    expect(reviewCaption("done", { insertions: 0, deletions: 0 })).toBe("Done");
    expect(reviewCaption("done", undefined)).toBe("Done");
  });
});

describe("planSegments", () => {
  it("marks finished steps, the live one, then the rest", () => {
    expect(planSegments({ completedSteps: 2, totalSteps: 5 })).toEqual([
      "done",
      "done",
      "live",
      "todo",
      "todo",
    ]);
    expect(planSegments({ completedSteps: 3, totalSteps: 3 })).toEqual(["done", "done", "done"]);
    expect(planSegments({ completedSteps: 0, totalSteps: 0 })).toEqual([]);
  });
});

describe("selectWorkingThreads", () => {
  const startedAt = (value: EnvironmentThreadShell) =>
    ({ late: "2026-11-01T10:05:00.000Z", early: "2026-11-01T10:00:00.000Z" })[String(value.id)] ??
    null;

  it("lists running threads oldest start first, leaving out blocked, idle and archived", () => {
    const rows = selectWorkingThreads(
      [
        thread("late", { session: running("running") }),
        thread("unknown", { session: running("starting") }),
        thread("early", { session: running("running") }),
        thread("idle", { session: running("ready") }),
        thread("gone", { session: running("running"), archivedAt: "2026-11-01T09:00:00.000Z" }),
        thread("waiting", { session: running("running") }),
      ],
      { blocked: [{ key: "local:waiting" } as never], earlier: [] },
      startedAt,
    );
    expect(rows.map((row) => String(row.thread.id))).toEqual(["early", "late", "unknown"]);
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

describe("workingCaption", () => {
  const resetAt = () => "14:20";
  it("names the step when a plan is reported", () => {
    expect(
      workingCaption(
        {
          agentState: undefined,
          planProgress: { step: "Updating the token map", completedSteps: 2, totalSteps: 5 },
        },
        resetAt,
      ),
    ).toBe("Step 3 of 5 · Updating the token map");
  });

  it("falls back to the agent state, then to Working", () => {
    expect(workingCaption({ agentState: undefined, planProgress: null }, resetAt)).toBe("Working");
    expect(
      workingCaption(
        {
          agentState: { kind: "retrying", attempt: 2, maxAttempts: 10 },
          planProgress: { step: "Ignored", completedSteps: 0, totalSteps: 2 },
        } as never,
        resetAt,
      ),
    ).toBe("Retrying · attempt 2 of 10");
  });
});
