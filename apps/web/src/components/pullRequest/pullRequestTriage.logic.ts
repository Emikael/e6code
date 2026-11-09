import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import type {
  EnvironmentId,
  PullRequestInvolvement,
  PullRequestListEntry,
  PullRequestListState,
  ThreadId,
} from "@e6tools/contracts";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@e6tools/shared/threadPullRequests";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";
import {
  isAuthoredByViewer,
  pullRequestEntryKey,
  pullRequestMergeReadinessTier,
  type PullRequestGroup,
  type PullRequestViewers,
} from "./pullRequestList.logic";

/** The semantic role a worded status is drawn in; each maps to a theme role, never a palette hue. */
export type PullRequestStatusTone = "success" | "warning" | "destructive" | "info" | "muted";

export type PullRequestRowStatusKind =
  | "ready"
  | "review"
  | "changes-requested"
  | "checks-failing"
  | "conflicts"
  | "checks-running"
  | "awaiting-review"
  | "checks-passed"
  | "draft"
  | "open"
  | "merged"
  | "closed";

export interface PullRequestRowStatus {
  readonly kind: PullRequestRowStatusKind;
  readonly label: string;
  readonly tone: PullRequestStatusTone;
  /**
   * What else is wrong that the label does not already say, such as failing checks under a
   * "Your review" chip. Null where the label is the whole story.
   */
  readonly detail: string | null;
}

/**
 * One worded status per row, read from the same tiers as the default readiness ranking: tier 0
 * is "Ready to merge", tier 4 always mentions the conflict, and a finished pull request says how
 * it finished. Inside a tier the most urgent fact wins the label and the rest go to `detail`.
 *
 * A review requested from the reader outranks everything still open but a draft, because the
 * next move on that row is theirs whatever its checks say. Check counts are not on list rows,
 * so failing checks are worded without a number.
 */
export function resolvePullRequestRowStatus(
  entry: Pick<
    PullRequestListEntry,
    | "state"
    | "isDraft"
    | "mergeability"
    | "checksState"
    | "reviewDecision"
    | "viewerReviewRequested"
  >,
  authoredByViewer: boolean,
): PullRequestRowStatus {
  if (entry.state === "merged") {
    return { kind: "merged", label: "Merged", tone: "info", detail: null };
  }
  if (entry.state === "closed") {
    return { kind: "closed", label: "Closed", tone: "muted", detail: null };
  }
  const failing = entry.checksState === "failing";
  const conflicting = entry.mergeability === "conflicting";
  const problems = [failing ? "checks failing" : null, conflicting ? "conflicts" : null].filter(
    (problem) => problem !== null,
  );
  const problemDetail = problems.length === 0 ? null : problems.join(" · ");
  if (entry.isDraft) {
    return { kind: "draft", label: "Draft", tone: "muted", detail: problemDetail };
  }
  if (entry.viewerReviewRequested && !authoredByViewer) {
    return {
      kind: "review",
      label: "Your review",
      tone: "info",
      detail: problemDetail ?? (entry.checksState === "pending" ? "checks running" : null),
    };
  }
  if (conflicting) {
    return {
      kind: "conflicts",
      label: failing ? "Checks failing · conflicts" : "Conflicts",
      tone: "destructive",
      detail: null,
    };
  }
  if (failing) {
    return { kind: "checks-failing", label: "Checks failing", tone: "destructive", detail: null };
  }
  if (entry.reviewDecision === "changes-requested") {
    return { kind: "changes-requested", label: "Changes requested", tone: "warning", detail: null };
  }
  if (entry.checksState === "pending") {
    return { kind: "checks-running", label: "Checks running", tone: "warning", detail: null };
  }
  if (pullRequestMergeReadinessTier(entry) === 0) {
    return { kind: "ready", label: "Ready to merge", tone: "success", detail: null };
  }
  if (entry.reviewDecision === "review-required") {
    return { kind: "awaiting-review", label: "Awaiting review", tone: "muted", detail: null };
  }
  if (entry.checksState === "passing") {
    return { kind: "checks-passed", label: "Checks passed", tone: "success", detail: null };
  }
  return { kind: "open", label: "Open", tone: "muted", detail: null };
}

/** Whether the status chip already states the review verdict, so a separate glyph would repeat it. */
export function pullRequestRowStatusStatesReview(kind: PullRequestRowStatusKind): boolean {
  return kind === "ready" || kind === "changes-requested" || kind === "awaiting-review";
}

/**
 * The page's tabs. Each is a named state and involvement pair the listing already understands,
 * so a tab is only a shortcut onto the filters; "Needs you" adds a local narrowing on top of the
 * open list, since what needs the reader is a judgement no host makes for us.
 */
export type PullRequestLens = "needs-you" | "yours" | "open" | "merged";

export const PULL_REQUEST_LENSES: ReadonlyArray<{
  readonly value: PullRequestLens;
  readonly label: string;
}> = [
  { value: "needs-you", label: "Needs you" },
  { value: "yours", label: "Yours" },
  { value: "open", label: "All open" },
  { value: "merged", label: "Merged" },
];

/** The tab the filters amount to, or null where they are something no tab names. */
export function pullRequestLensOf(scope: {
  readonly state: PullRequestListState;
  readonly involvement: PullRequestInvolvement;
  readonly lens?: "needs-you" | undefined;
}): PullRequestLens | null {
  if (scope.state === "open" && scope.involvement === "all") {
    return scope.lens === "needs-you" ? "needs-you" : "open";
  }
  if (scope.state === "open" && scope.involvement === "authored") return "yours";
  if (scope.state === "merged" && scope.involvement === "all") return "merged";
  return null;
}

/** The filters a tab stands for; picking one clears the "Needs you" narrowing unless it is it. */
export function pullRequestLensScope(lens: PullRequestLens): {
  readonly state: PullRequestListState;
  readonly involvement: PullRequestInvolvement;
  readonly lens: "needs-you" | undefined;
} {
  switch (lens) {
    case "needs-you":
      return { state: "open", involvement: "all", lens: "needs-you" };
    case "yours":
      return { state: "open", involvement: "authored", lens: undefined };
    case "open":
      return { state: "open", involvement: "all", lens: undefined };
    case "merged":
      return { state: "merged", involvement: "all", lens: undefined };
  }
}

type TriageEntry = PullRequestListEntry & { readonly environmentId?: string };

/**
 * The next move on this pull request is the reader's: somebody asked them for a review, or it is
 * theirs and blocked on something only they can fix — failing checks, requested changes, a
 * conflict — or theirs and ready to merge.
 */
function pullRequestNeedsViewer(entry: TriageEntry, authoredByViewer: boolean): boolean {
  if (entry.state !== "open") return false;
  if (entry.viewerReviewRequested && !authoredByViewer) return !entry.isDraft;
  if (!authoredByViewer) return false;
  return (
    entry.checksState === "failing" ||
    entry.reviewDecision === "changes-requested" ||
    entry.mergeability === "conflicting" ||
    pullRequestMergeReadinessTier(entry) === 0
  );
}

/** The reader's own open, non-draft work whose next move is somebody else's. */
function isWaitingOnOthers(entry: TriageEntry, authoredByViewer: boolean): boolean {
  return (
    authoredByViewer &&
    entry.state === "open" &&
    !entry.isDraft &&
    !pullRequestNeedsViewer(entry, authoredByViewer)
  );
}

/**
 * The "Needs you" tab's two shelves: what needs the reader, then their own work waiting on
 * reviewers or checks. Everything else on the open list is left out.
 */
export function groupPullRequestsForNeedsYou<Entry extends TriageEntry>(
  entries: ReadonlyArray<Entry>,
  viewers: PullRequestViewers,
): ReadonlyArray<PullRequestGroup<Entry>> {
  const needsYou: Entry[] = [];
  const waiting: Entry[] = [];
  for (const entry of entries) {
    const authored = isAuthoredByViewer(entry, viewers);
    if (pullRequestNeedsViewer(entry, authored)) needsYou.push(entry);
    else if (isWaitingOnOthers(entry, authored)) waiting.push(entry);
  }
  return [
    { key: "needsYou" as const, label: "Needs you", entries: needsYou },
    { key: "waitingOnOthers" as const, label: "Waiting on others", entries: waiting },
  ].filter((group) => group.entries.length > 0);
}

/** A tab's count, and whether more rows exist on the hosts than were read to count it. */
export interface PullRequestLensCount {
  readonly count: number;
  readonly more: boolean;
}

export type PullRequestLensCounts = Record<PullRequestLens, PullRequestLensCount | null>;

/** One listing answer as the counts need it. */
interface LensCountSource {
  readonly entries: ReadonlyArray<TriageEntry>;
  readonly truncated: boolean;
}

/**
 * The tab counts from what has been read, and nothing guessed. A listing that stopped short says
 * so with "+" rather than passing its page size off as the total; a tab nothing has been read for
 * has no count at all.
 *
 * "Needs you" and "Yours" come from the authored and review-requested reads where they are in,
 * because those are whole up to their own page while the open feed is sliced by recency. Every
 * row "Needs you" counts is either authored or review-requested, so the two together cover it.
 */
export function pullRequestLensCounts(input: {
  readonly viewers: PullRequestViewers;
  readonly open: LensCountSource | null;
  readonly authored: LensCountSource | null;
  readonly reviewing: LensCountSource | null;
  readonly merged: LensCountSource | null;
}): PullRequestLensCounts {
  const { viewers, open, authored, reviewing, merged } = input;
  const whole = (source: LensCountSource | null) =>
    source === null ? null : { count: source.entries.length, more: source.truncated };

  const mine =
    authored !== null
      ? {
          entries: authored.entries.filter((entry) => isAuthoredByViewer(entry, viewers)),
          truncated: authored.truncated,
        }
      : open !== null && !open.truncated
        ? {
            entries: open.entries.filter((entry) => isAuthoredByViewer(entry, viewers)),
            truncated: false,
          }
        : null;

  const needsSource =
    authored !== null && reviewing !== null
      ? {
          entries: [
            ...new Map(
              [...authored.entries, ...reviewing.entries].map((entry) => [
                pullRequestEntryKey(entry),
                entry,
              ]),
            ).values(),
          ],
          truncated: authored.truncated || reviewing.truncated,
        }
      : open !== null && !open.truncated
        ? open
        : null;
  const needsYou =
    needsSource === null
      ? null
      : {
          count: needsSource.entries.filter((entry) =>
            pullRequestNeedsViewer(entry, isAuthoredByViewer(entry, viewers)),
          ).length,
          more: needsSource.truncated,
        };

  return {
    "needs-you": needsYou,
    yours: whole(mine),
    open: whole(open),
    merged: whole(merged),
  };
}

export function formatPullRequestLensCount(count: PullRequestLensCount): string {
  return count.more ? `${count.count}+` : String(count.count);
}

/**
 * Fresh counts laid over the ones held from earlier under the same filters, so a tab whose rows
 * are not being read right now keeps its last count. Returns `held` itself when nothing changed,
 * which is what lets a caller store the result without looping.
 */
export function holdPullRequestLensCounts(
  live: PullRequestLensCounts,
  held: PullRequestLensCounts | null,
): PullRequestLensCounts {
  const next: PullRequestLensCounts = {
    "needs-you": live["needs-you"] ?? held?.["needs-you"] ?? null,
    yours: live.yours ?? held?.yours ?? null,
    open: live.open ?? held?.open ?? null,
    merged: live.merged ?? held?.merged ?? null,
  };
  if (held === null) return next;
  const same = PULL_REQUEST_LENSES.every(({ value }) => {
    const left = next[value];
    const right = held[value];
    return left === right || (left?.count === right?.count && left?.more === right?.more);
  });
  return same ? held : next;
}

/** A thread as the join needs it: its links, and enough of its session to say it is working. */
type LinkedThreadShell = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "title"
  | "updatedAt"
  | "archivedAt"
  | "pullRequests"
  | "linkedPullRequest"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "session"
  | "backgroundLiveness"
  | "agentState"
>;

/** The threads working on one pull request, for its row. */
export interface PullRequestLinkedThreads {
  /** The thread a click opens: a working one first, then the most recently updated. */
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  /** An agent in one of the linked threads is running a turn or background work right now. */
  readonly working: boolean;
  readonly count: number;
}

/** The identity a listing row and a thread link share: host, repository and number. */
export function pullRequestRowThreadKey(
  entry: Pick<PullRequestListEntry, "host" | "repository" | "number" | "url">,
): string {
  return threadPullRequestKeyOf(entry);
}

/**
 * Which threads are linked to which pull requests, keyed by `pullRequestRowThreadKey`. Matched
 * by host, repository and number rather than by server, because a repository listed by one
 * connected server can be worked on in a thread on another. Archived threads are left out, and a
 * legacy single link counts the same as the newer list of links.
 */
export function joinPullRequestThreads(
  threads: ReadonlyArray<LinkedThreadShell>,
): ReadonlyMap<string, PullRequestLinkedThreads> {
  const byKey = new Map<string, Array<{ thread: LinkedThreadShell; working: boolean }>>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const keys = new Set(
      visibleThreadPullRequests(thread.pullRequests).map((link) => threadPullRequestKeyOf(link)),
    );
    if (keys.size === 0 && thread.linkedPullRequest) {
      keys.add(threadPullRequestKeyOf(legacyThreadPullRequestKey(thread.linkedPullRequest)));
    }
    if (keys.size === 0) continue;
    const working = resolveSidebarThreadStatus(thread) === "working";
    for (const key of keys) {
      const held = byKey.get(key) ?? [];
      held.push({ thread, working });
      byKey.set(key, held);
    }
  }
  const joined = new Map<string, PullRequestLinkedThreads>();
  for (const [key, linked] of byKey) {
    const chosen = linked.toSorted(
      (left, right) =>
        Number(right.working) - Number(left.working) ||
        right.thread.updatedAt.localeCompare(left.thread.updatedAt),
    )[0]!;
    joined.set(key, {
      environmentId: chosen.thread.environmentId,
      threadId: chosen.thread.id,
      title: chosen.thread.title,
      working: chosen.working,
      count: linked.length,
    });
  }
  return joined;
}

/**
 * A fresh join laid over the last one so that unchanged rows keep the very object they had, and
 * an unchanged join is the previous map itself. Threads update on every turn event; a row should
 * only redraw when what it shows about its threads did.
 */
export function reconcilePullRequestThreads(
  previous: ReadonlyMap<string, PullRequestLinkedThreads>,
  next: ReadonlyMap<string, PullRequestLinkedThreads>,
): ReadonlyMap<string, PullRequestLinkedThreads> {
  let changed = previous.size !== next.size;
  const reconciled = new Map<string, PullRequestLinkedThreads>();
  for (const [key, value] of next) {
    const held = previous.get(key);
    const same =
      held !== undefined &&
      held.environmentId === value.environmentId &&
      held.threadId === value.threadId &&
      held.title === value.title &&
      held.working === value.working &&
      held.count === value.count;
    changed ||= !same;
    reconciled.set(key, same ? held : value);
  }
  return changed ? reconciled : previous;
}
