import type { PullRequestListEntry } from "@e6tools/contracts";

import { pullRequestMergeReadinessTier } from "./pullRequestList.logic";

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
