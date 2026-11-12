import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@e6tools/client-runtime/environment";
import {
  formatRunningThreadStatus,
  joinThreadRowStatus,
} from "@e6tools/client-runtime/state/agent-state";
import type {
  ThreadAttention,
  ThreadAttentionKind,
} from "@e6tools/client-runtime/state/thread-attention";
import type { EnvironmentId, ProjectId, ProjectScript, VcsStatusResult } from "@e6tools/contracts";
import {
  isWorktreeSetupStale,
  projectScriptHash,
  setupProjectScript,
} from "@e6tools/shared/projectScripts";

/** "Needs you · 2 agents are blocked", the start screen's first list heading. */
export function needsYouHeading(blockedCount: number): string {
  return blockedCount === 1
    ? "Needs you · 1 agent is blocked"
    : `Needs you · ${blockedCount} agents are blocked`;
}

/** Ends a fact with a period unless it already ends a sentence ("…fade?"). */
export function asSentence(fact: string): string {
  return /[.?!…]$/.test(fact) ? fact : `${fact}.`;
}

/**
 * "asked 4m ago", "ready 26m ago", "finished just now". Past a day the age
 * names the day ("asked Tue") instead of growing.
 */
export function formatAttentionCue(verb: string, age: string): string {
  if (age === "") return "";
  if (age === "now") return `${verb} just now`;
  if (age.startsWith("since ")) return `${verb} ${age.slice("since ".length)}`;
  return `${verb} ${age} ago`;
}

/** The time cue verb for an attention row: who waited, or what happened. */
export function attentionCueVerb(kind: ThreadAttentionKind): string {
  switch (kind) {
    case "approval":
    case "input":
      return "asked";
    case "failed":
      return "failed";
    case "plan":
      return "ready";
    case "done":
      return "finished";
  }
}

/** "Done · +4 −4" when the turn changed lines, else "Done"; plans read "Plan ready". */
export function reviewCaption(
  kind: "plan" | "done",
  diffStat: { readonly insertions: number; readonly deletions: number } | undefined,
): string {
  if (kind === "plan") return "Plan ready";
  if (!diffStat || (diffStat.insertions === 0 && diffStat.deletions === 0)) return "Done";
  return `Done · +${diffStat.insertions} −${diffStat.deletions}`;
}

export type PlanSegment = "done" | "live" | "todo";

/** The step meter: finished steps, the one running, then the rest. */
export function planSegments(progress: {
  readonly completedSteps: number;
  readonly totalSteps: number;
}): ReadonlyArray<PlanSegment> {
  const total = Math.max(0, progress.totalSteps);
  const done = Math.min(Math.max(0, progress.completedSteps), total);
  return Array.from({ length: total }, (_, index) =>
    index < done ? "done" : index === done ? "live" : "todo",
  );
}

/**
 * What a working agent is doing, in one line: "Step 3 of 5 · Updating the
 * token map" when it reports a plan, otherwise its state ("Retrying ·
 * attempt 2 of 10", "Compacting") or plain "Working". OpenCode reports no
 * plan and always takes the fallback.
 */
export function workingCaption(
  thread: Pick<EnvironmentThreadShell, "agentState" | "planProgress">,
  formatResetTime: (resetsAt: string) => string,
): string {
  const progress = thread.planProgress;
  if (!thread.agentState && progress && progress.totalSteps > 0) {
    const step = Math.min(progress.completedSteps + 1, progress.totalSteps);
    return `Step ${step} of ${progress.totalSteps} · ${progress.step}`;
  }
  const status = formatRunningThreadStatus({
    agentState: thread.agentState,
    planProgress: null,
    formatResetTime,
  });
  return joinThreadRowStatus(status);
}

export interface WorkingThread {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  /** When the running turn started, or null when unknown. */
  readonly startedAt: string | null;
}

/**
 * Threads an agent is working on right now, for the start screen's Working
 * list, oldest start first so rows never reshuffle. A thread already in
 * Needs you is left out: it is waiting on you, not working.
 */
export function selectWorkingThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  attention: Pick<ThreadAttention<EnvironmentThreadShell>, "blocked" | "earlier">,
  startedAt: (thread: EnvironmentThreadShell) => string | null,
): ReadonlyArray<WorkingThread> {
  const blocked = new Set([...attention.blocked, ...attention.earlier].map((item) => item.key));
  const working: WorkingThread[] = [];
  for (const thread of threads) {
    const status = thread.session?.status;
    if (thread.archivedAt !== null || (status !== "running" && status !== "starting")) continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (blocked.has(key)) continue;
    working.push({ key, thread, startedAt: startedAt(thread) });
  }
  const timeOf = (row: WorkingThread) => {
    const ms = Date.parse(row.startedAt ?? "");
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return working.sort((a, b) => timeOf(a) - timeOf(b) || a.key.localeCompare(b.key));
}

/**
 * The project's most recently updated thread whose worktree ran an older
 * setup script than the project has now, for the "Setup script changed"
 * pick-up item. Threads in the project folder have no worktree to compare
 * and never qualify; neither do archived threads or worktrees without a
 * branch to name.
 *
 * `currentHash` is what dismissing records: the user says the worktree is
 * fine as it is, so it now matches the current setup script.
 */
export function selectStaleSetupThread(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  project: {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly scripts: ReadonlyArray<ProjectScript>;
  } | null,
): StaleSetupThread | null {
  const setup = project ? setupProjectScript(project.scripts) : null;
  if (!project || !setup) return null;
  let latest: StaleSetupThread | null = null;
  for (const thread of threads) {
    if (thread.environmentId !== project.environmentId || thread.projectId !== project.id) continue;
    if (thread.archivedAt !== null || thread.branch === null) continue;
    if (!isWorktreeSetupStale(thread, project.scripts)) continue;
    if (latest === null || thread.updatedAt > latest.thread.updatedAt) {
      latest = { thread, branch: thread.branch, currentHash: projectScriptHash(setup) };
    }
  }
  return latest;
}

export interface StaleSetupThread {
  readonly thread: EnvironmentThreadShell;
  readonly branch: string;
  readonly currentHash: string;
}

export interface UnpushedCommits {
  readonly count: number;
  readonly refName: string;
  /** An open pull request already tracks the branch; pushing updates it. */
  readonly hasOpenPullRequest: boolean;
}

/**
 * Commits on the checked-out branch that its remote does not have yet: the
 * count ahead of the upstream, or, for a branch never pushed, ahead of the
 * default branch. Null when there is nothing to push or nowhere to push it.
 */
export function selectUnpushedCommits(
  status:
    | Pick<
        VcsStatusResult,
        | "isRepo"
        | "refName"
        | "hasPrimaryRemote"
        | "isDefaultRef"
        | "hasUpstream"
        | "aheadCount"
        | "aheadOfDefaultCount"
        | "pr"
      >
    | null
    | undefined,
): UnpushedCommits | null {
  if (!status?.isRepo || !status.refName || !status.hasPrimaryRemote) return null;
  const count = status.hasUpstream
    ? status.aheadCount
    : status.isDefaultRef
      ? 0
      : (status.aheadOfDefaultCount ?? 0);
  if (count === 0) return null;
  return {
    count,
    refName: status.refName,
    hasOpenPullRequest: status.pr?.state === "open",
  };
}
