import type { PullRequestListEntry } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pullRequestMergeReadinessTier } from "./pullRequestList.logic";
import { resolvePullRequestRowStatus } from "./pullRequestTriage.logic";

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
