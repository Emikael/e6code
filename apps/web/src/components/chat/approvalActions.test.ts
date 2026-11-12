import { describe, expect, it } from "vite-plus/test";

import {
  APPROVAL_SWAP_GUARD_MS,
  approvalActivationAllowed,
  approvalAnswerAnnouncement,
  approvalMoreLabel,
  DEFAULT_APPROVAL_OPTIONS,
  firstUnansweredRequest,
  layoutApprovalActions,
  pruneAnsweredRequestIds,
} from "./approvalActions";

describe("layoutApprovalActions", () => {
  it("puts Approve and Decline up front and the rest under More", () => {
    const layout = layoutApprovalActions(undefined, null);
    expect(layout.approve).toEqual({
      kind: "button",
      option: { decision: "accept", label: "Approve" },
    });
    expect(layout.decline?.label).toBe("Decline");
    expect(layout.more.map((option) => option.label)).toEqual([
      "Cancel",
      "Always allow this session",
    ]);
  });

  it("makes a destructive Approve a hold and never offers a session-wide allow", () => {
    const layout = layoutApprovalActions(
      [...DEFAULT_APPROVAL_OPTIONS, { decision: "acceptAlways", label: "Always allow" }],
      { reason: "Deletes files recursively" },
    );
    expect(layout.approve).toEqual({
      kind: "hold",
      option: { decision: "accept", label: "Approve" },
      reason: "Deletes files recursively",
    });
    expect(layout.more.map((option) => option.decision)).toEqual(["cancel"]);
  });

  it("offers no Approve when the provider does not", () => {
    const layout = layoutApprovalActions([{ decision: "decline", label: "Deny" }], null);
    expect(layout.approve).toBeNull();
    expect(layout.decline?.label).toBe("Deny");
    expect(layout.more).toEqual([]);
  });
});

describe("approvalMoreLabel", () => {
  it("names what More holds", () => {
    expect(
      approvalMoreLabel(
        [{ decision: "acceptForSession", label: "Always allow this session" }],
        true,
      ),
    ).toBe("More: always allow this session, decline with a message");
    expect(approvalMoreLabel([], false)).toBe("More");
  });
});

describe("answered approvals", () => {
  it("keeps an answered request hidden until it leaves the pending list", () => {
    const approvals = [{ requestId: "a" }, { requestId: "b" }];
    // Acknowledged, but the provider's resolution has not arrived: skip it.
    const answered = new Set(["a"]);
    expect(firstUnansweredRequest(approvals, answered)).toEqual({
      request: { requestId: "b" },
      index: 0,
      total: 1,
    });
    // Still pending: keep it, and return the same set so nothing re-renders.
    expect(pruneAnsweredRequestIds(answered, ["a", "b"])).toBe(answered);
    // Resolved: forget it.
    expect([...pruneAnsweredRequestIds(answered, ["b"])]).toEqual([]);
    expect(firstUnansweredRequest(approvals, new Set(["a", "b"]))).toBeNull();
  });

  it("ignores a click for a moment after the shown request changes", () => {
    expect(approvalActivationAllowed(1_000, 1_000 + APPROVAL_SWAP_GUARD_MS - 1)).toBe(false);
    expect(approvalActivationAllowed(1_000, 1_000 + APPROVAL_SWAP_GUARD_MS)).toBe(true);
  });

  it("says what was answered", () => {
    expect(approvalAnswerAnnouncement("accept", "vp test run")).toBe("Approved: vp test run");
    expect(approvalAnswerAnnouncement("acceptForSession", "vp test run")).toBe(
      "Approved: vp test run",
    );
    expect(approvalAnswerAnnouncement("decline", "rm -rf dist")).toBe("Declined: rm -rf dist");
  });
});
