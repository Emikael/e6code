import { ProjectId, type PullRequestSummary, type VcsStatusResult } from "@e6tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  resolveThreadPullRequestBadgePresentation,
} from "./ThreadStatusIndicators";
import { newestPullRequestSummary } from "../state/pullRequests";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

describe("ChangeRequestStatusIcon", () => {
  it.each([
    ["open", "open", false, PullRequestGlyph.pullRequest],
    ["draft", "open", true, PullRequestGlyph.draft],
    ["closed", "closed", false, PullRequestGlyph.closed],
    ["merged", "merged", false, PullRequestGlyph.merged],
  ] as const)("uses the %s pull request glyph", (_label, state, isDraft, expectedIcon) => {
    expect(ChangeRequestStatusIcon({ state, isDraft }).type).toBe(expectedIcon);
  });
});

function status(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/current",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: {
      number: 42,
      title: "PR branch",
      url: "https://github.com/emikael/e6code/pull/42",
      baseRef: "main",
      headRef: "feature/current",
      state: "open",
    },
    ...overrides,
  };
}

function pullRequestSummary(
  state: PullRequestSummary["state"],
  updatedAt: string,
): PullRequestSummary {
  return {
    provider: "github",
    projectId: ProjectId.make("project-1"),
    repository: "emikael/e6code",
    number: 42,
    title: "Feature PR",
    url: "https://github.com/emikael/e6code/pull/42",
    state,
    headBranch: "feature/current",
    baseBranch: "main",
    updatedAt,
  };
}

describe("shared pull request state", () => {
  it("shows a panel-observed merge instead of an older sidebar summary", () => {
    const open = pullRequestSummary("open", "2026-09-03T01:00:00.000Z");
    const merged = pullRequestSummary("merged", "2026-09-03T01:01:00.000Z");

    expect(newestPullRequestSummary(open, merged)).toBe(merged);
  });

  it("never lets a stale open response regress a merged observation", () => {
    const merged = pullRequestSummary("merged", "2026-09-03T01:01:00.000Z");
    const staleOpen = pullRequestSummary("open", "2026-09-03T01:00:00.000Z");

    expect(newestPullRequestSummary(merged, staleOpen)).toBe(merged);
  });

  it("accepts a newer open state after a closed pull request is reopened", () => {
    const closed = pullRequestSummary("closed", "2026-09-03T01:00:00.000Z");
    const reopened = pullRequestSummary("open", "2026-09-03T01:01:00.000Z");

    expect(newestPullRequestSummary(closed, reopened)).toBe(reopened);
  });
});

describe("prStatusIndicator", () => {
  it("formats PR tooltips with number, uppercase status, and title", () => {
    expect(prStatusIndicator(status().pr, undefined)).toMatchObject({
      tooltip: "PR #42 - Open: PR branch",
      tooltipLead: "PR #42 - Open",
      tooltipTitle: "PR branch",
    });
  });

  it("uses the destructive role for closed pull requests", () => {
    const closedPr = status().pr;
    if (!closedPr) throw new Error("Expected pull request fixture");

    expect(prStatusIndicator({ ...closedPr, state: "closed" }, undefined)?.colorClass).toContain(
      "text-destructive-foreground",
    );
  });

  it("uses muted and draft wording for draft pull requests", () => {
    const draftPr = status().pr;
    if (!draftPr) throw new Error("Expected pull request fixture");

    expect(prStatusIndicator({ ...draftPr, isDraft: true }, undefined)).toMatchObject({
      label: "PR draft",
      colorClass: "text-muted-foreground",
      tooltipLead: "PR #42 - Draft",
    });
  });
});

describe("resolveThreadPullRequestBadgePresentation", () => {
  const url = "https://github.com/emikael/e6code/pull/42";

  it("returns the pending pull-request badge when no snapshot is available", () => {
    expect(
      resolveThreadPullRequestBadgePresentation({
        badge: null,
        number: 42,
        url,
        status: null,
      }),
    ).toEqual({
      Icon: PullRequestGlyph.pullRequest,
      toneClassName: "text-muted-foreground",
      label: "PR #42, status pending",
      text: 42,
    });
  });

  it.each([
    [
      "open",
      { state: "open", isDraft: false },
      PullRequestGlyph.pullRequest,
      "text-success-foreground",
      "PR #42 - Open: PR branch",
    ],
    [
      "draft",
      { state: "open", isDraft: true },
      PullRequestGlyph.draft,
      "text-muted-foreground",
      "PR #42 - Draft: PR branch",
    ],
    [
      "closed",
      { state: "closed", isDraft: false },
      PullRequestGlyph.closed,
      "text-destructive-foreground",
      "PR #42 - Closed: PR branch",
    ],
    [
      "merged",
      { state: "merged", isDraft: false },
      PullRequestGlyph.merged,
      "text-violet-600 dark:text-violet-300/90",
      "PR #42 - Merged: PR branch",
    ],
  ] as const)(
    "keeps the %s state for one linked pull request",
    (_state, prOverrides, expectedIcon, expectedToneClassName, expectedLabel) => {
      const fixture = status().pr;
      if (!fixture) throw new Error("Expected pull request fixture");
      const prStatus = prStatusIndicator({ ...fixture, ...prOverrides }, undefined);
      if (!prStatus) throw new Error("Expected pull request status");

      expect(
        resolveThreadPullRequestBadgePresentation({
          badge: { kind: "pull-request", others: 0, state: "open" },
          number: fixture.number,
          url: fixture.url,
          status: prStatus,
        }),
      ).toEqual({
        Icon: expectedIcon,
        toneClassName: expectedToneClassName,
        label: expectedLabel,
        text: fixture.number,
      });
    },
  );

  it.each([
    ["open", "text-success-foreground"],
    ["draft", "text-muted-foreground"],
    ["merged", "text-violet-600 dark:text-violet-300/90"],
  ] as const)(
    "uses a layers badge with the %s stack tone without a link identity",
    (state, expectedToneClassName) => {
      expect(
        resolveThreadPullRequestBadgePresentation({
          badge: { kind: "stack", layers: 3, state },
          status: null,
        }),
      ).toEqual({
        Icon: PullRequestGlyph.stack,
        toneClassName: expectedToneClassName,
        label: `Stack of 3 pull requests, ${state}`,
        text: 3,
      });
    },
  );

  it.each([
    ["open", PullRequestGlyph.pullRequest, "text-success-foreground"],
    ["draft", PullRequestGlyph.draft, "text-muted-foreground"],
    ["merged", PullRequestGlyph.merged, "text-violet-600 dark:text-violet-300/90"],
  ] as const)(
    "draws the count of unrelated linked pull requests with their %s aggregate state",
    (state, expectedIcon, expectedToneClassName) => {
      const fixture = status().pr;
      if (!fixture) throw new Error("Expected pull request fixture");
      const closedStatus = prStatusIndicator(
        { ...fixture, state: "closed", isDraft: false },
        undefined,
      );
      if (!closedStatus) throw new Error("Expected pull request status");

      expect(
        resolveThreadPullRequestBadgePresentation({
          badge: { kind: "pull-request", others: 2, state },
          number: fixture.number,
          url: fixture.url,
          status: closedStatus,
        }),
      ).toEqual({
        Icon: expectedIcon,
        toneClassName: expectedToneClassName,
        label: `PR #42 - Closed: PR branch, and 2 more linked; overall ${state}`,
        text: "+3",
      });
    },
  );

  it("omits the control when neither a stack nor a linked identity can be shown", () => {
    expect(resolveThreadPullRequestBadgePresentation({ badge: null, status: null })).toBeNull();
  });
});
