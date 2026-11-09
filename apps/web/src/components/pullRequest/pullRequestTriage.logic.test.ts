import type { PullRequestListEntry } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pullRequestMergeReadinessTier } from "./pullRequestList.logic";
import {
  formatPullRequestLensCount,
  groupPullRequestsForNeedsYou,
  holdPullRequestLensCounts,
  pullRequestLensCounts,
  pullRequestLensOf,
  pullRequestLensScope,
  resolvePullRequestRowStatus,
} from "./pullRequestTriage.logic";

const VIEWERS = { "github.com": "me" } as const;

function row(
  number: number,
  overrides: Partial<PullRequestListEntry> & { readonly mine?: boolean } = {},
): PullRequestListEntry {
  const { mine = false, ...rest } = overrides;
  return {
    provider: "github",
    host: "github.com",
    projectId: "project-1",
    projectTitle: "e6code",
    repository: "emikael/e6code",
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/emikael/e6code/pull/${number}`,
    author: { login: mine ? "me" : "someone", name: null, avatarUrl: null },
    headBranch: `branch-${number}`,
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 1,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    viewerReviewRequested: false,
    labels: [],
    checksState: "pending",
    reviewDecision: "review-required",
    ...rest,
  } as PullRequestListEntry;
}

describe("pull request tabs", () => {
  it("names the tab the filters amount to, and none for filters no tab covers", () => {
    expect(pullRequestLensOf({ state: "open", involvement: "all", lens: "needs-you" })).toBe(
      "needs-you",
    );
    expect(pullRequestLensOf({ state: "open", involvement: "all" })).toBe("open");
    expect(pullRequestLensOf({ state: "open", involvement: "authored" })).toBe("yours");
    expect(pullRequestLensOf({ state: "merged", involvement: "all" })).toBe("merged");
    expect(pullRequestLensOf({ state: "closed", involvement: "all" })).toBeNull();
    expect(pullRequestLensOf({ state: "open", involvement: "reviewing" })).toBeNull();
  });

  it("round-trips every tab through the filters it stands for", () => {
    for (const lens of ["needs-you", "yours", "open", "merged"] as const) {
      expect(pullRequestLensOf(pullRequestLensScope(lens))).toBe(lens);
    }
  });
});

describe("what needs the reader", () => {
  const entries = [
    row(1, { viewerReviewRequested: true }),
    row(2, { mine: true, checksState: "failing" }),
    row(3, { mine: true, reviewDecision: "changes-requested", checksState: "passing" }),
    row(4, { mine: true, mergeability: "conflicting" }),
    row(5, { mine: true, checksState: "passing", reviewDecision: "approved" }),
    row(6, { mine: true }),
    row(7, { mine: true, isDraft: true }),
    row(8),
    row(9, { viewerReviewRequested: true, isDraft: true }),
  ];

  it("shelves review requests and the reader's blocked or ready work, then their waiting work", () => {
    const groups = groupPullRequestsForNeedsYou(entries, VIEWERS);
    expect(groups.map((group) => [group.key, group.entries.map((entry) => entry.number)])).toEqual([
      ["needsYou", [1, 2, 3, 4, 5]],
      ["waitingOnOthers", [6]],
    ]);
  });

  it("counts the tabs from the partitions, marking a read that stopped at its page", () => {
    const counts = pullRequestLensCounts({
      viewers: VIEWERS,
      open: { entries, truncated: true },
      authored: {
        entries: entries.filter((entry) => entry.author?.login === "me"),
        truncated: false,
      },
      reviewing: { entries: [entries[0]!, entries[8]!], truncated: false },
      merged: null,
    });
    expect(counts["needs-you"]).toEqual({ count: 5, more: false });
    expect(counts.yours).toEqual({ count: 6, more: false });
    expect(counts.open).toEqual({ count: 9, more: true });
    expect(counts.merged).toBeNull();
    expect(formatPullRequestLensCount(counts.open!)).toBe("9+");
  });

  it("refuses to count from a sliced feed when the partitions have not answered", () => {
    const counts = pullRequestLensCounts({
      viewers: VIEWERS,
      open: { entries, truncated: true },
      authored: null,
      reviewing: null,
      merged: { entries: [row(10, { state: "merged" })], truncated: false },
    });
    expect(counts["needs-you"]).toBeNull();
    expect(counts.yours).toBeNull();
    expect(counts.merged).toEqual({ count: 1, more: false });
  });

  it("counts from a whole feed when it is all there is", () => {
    const counts = pullRequestLensCounts({
      viewers: VIEWERS,
      open: { entries, truncated: false },
      authored: null,
      reviewing: null,
      merged: null,
    });
    expect(counts["needs-you"]).toEqual({ count: 5, more: false });
    expect(counts.yours).toEqual({ count: 6, more: false });
  });

  it("keeps the last count of a tab that is not being read, and settles once nothing changes", () => {
    const held = {
      "needs-you": { count: 3, more: false },
      yours: { count: 4, more: false },
      open: { count: 12, more: false },
      merged: null,
    };
    const onMerged = holdPullRequestLensCounts(
      { "needs-you": null, yours: null, open: null, merged: { count: 38, more: true } },
      held,
    );
    expect(onMerged).toEqual({ ...held, merged: { count: 38, more: true } });
    expect(
      holdPullRequestLensCounts(
        { "needs-you": null, yours: null, open: null, merged: { count: 38, more: true } },
        onMerged,
      ),
    ).toBe(onMerged);
  });
});

type StatusInput = Parameters<typeof resolvePullRequestRowStatus>[0];

const OPEN: StatusInput = {
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  checksState: "passing",
  reviewDecision: "approved",
  viewerReviewRequested: false,
};

const status = (overrides: Partial<StatusInput>, authored = false) =>
  resolvePullRequestRowStatus({ ...OPEN, ...overrides }, authored);

describe("worded pull request row status", () => {
  it("calls green, approved, conflict-free work ready to merge, the readiness ranking's first tier", () => {
    expect(pullRequestMergeReadinessTier(OPEN as PullRequestListEntry)).toBe(0);
    expect(status({})).toEqual({
      kind: "ready",
      label: "Ready to merge",
      tone: "success",
      detail: null,
    });
  });

  it("names both problems when a conflicting branch also fails its checks", () => {
    expect(status({ mergeability: "conflicting", checksState: "failing" })).toMatchObject({
      label: "Checks failing · conflicts",
      tone: "destructive",
    });
    // Conflicts are the ranking's last tier whatever the review says.
    expect(status({ mergeability: "conflicting" })).toMatchObject({ label: "Conflicts" });
  });

  it("puts a requested review first and keeps the problems as detail", () => {
    expect(
      status({ viewerReviewRequested: true, checksState: "failing", mergeability: "conflicting" }),
    ).toEqual({
      kind: "review",
      label: "Your review",
      tone: "info",
      detail: "checks failing · conflicts",
    });
    expect(status({ viewerReviewRequested: true, checksState: "pending" }).detail).toBe(
      "checks running",
    );
  });

  it("does not ask the author to review their own pull request", () => {
    expect(status({ viewerReviewRequested: true }, true).kind).toBe("ready");
  });

  it("words the open tiers by what blocks them", () => {
    expect(status({ checksState: "failing" })).toMatchObject({
      label: "Checks failing",
      tone: "destructive",
    });
    expect(status({ reviewDecision: "changes-requested" })).toMatchObject({
      label: "Changes requested",
      tone: "warning",
    });
    expect(status({ checksState: "pending" })).toMatchObject({
      label: "Checks running",
      tone: "warning",
    });
    expect(status({ reviewDecision: "review-required" })).toMatchObject({
      label: "Awaiting review",
      tone: "muted",
    });
    expect(status({ reviewDecision: undefined })).toMatchObject({ label: "Checks passed" });
    expect(status({ reviewDecision: undefined, checksState: undefined })).toMatchObject({
      label: "Open",
    });
  });

  it("keeps drafts as drafts while still saying what is wrong with them", () => {
    expect(status({ isDraft: true, checksState: "failing" })).toEqual({
      kind: "draft",
      label: "Draft",
      tone: "muted",
      detail: "checks failing",
    });
  });

  it("says how a finished pull request finished", () => {
    expect(status({ state: "merged" })).toMatchObject({ label: "Merged", tone: "info" });
    expect(status({ state: "closed", mergeability: "conflicting" })).toMatchObject({
      label: "Closed",
    });
  });
});
