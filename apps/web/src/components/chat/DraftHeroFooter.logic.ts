import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ProjectScript, VcsStatusResult } from "@e6tools/contracts";
import {
  isWorktreeSetupStale,
  projectScriptHash,
  setupProjectScript,
} from "@e6tools/shared/projectScripts";

export type PickUpReason = "approval" | "input";

export interface PickUpThread {
  readonly thread: EnvironmentThreadShell;
  readonly reason: PickUpReason;
}

/**
 * Threads that are blocked on the user, for the new-thread hero's "Pick up
 * where you left off" list: an approval to grant comes before a question to
 * answer, then the most recently updated first. Archived threads and threads
 * snoozed into the future stay out, like they do in the sidebar's inbox.
 */
export function selectPickUpThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  options: { readonly limit: number; readonly nowMs: number },
): ReadonlyArray<PickUpThread> {
  const waiting: PickUpThread[] = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    if (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > options.nowMs) continue;
    if (thread.hasPendingApprovals) waiting.push({ thread, reason: "approval" });
    else if (thread.hasPendingUserInput) waiting.push({ thread, reason: "input" });
  }
  return waiting
    .sort(
      (a, b) =>
        (a.reason === b.reason ? 0 : a.reason === "approval" ? -1 : 1) ||
        b.thread.updatedAt.localeCompare(a.thread.updatedAt),
    )
    .slice(0, options.limit);
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
