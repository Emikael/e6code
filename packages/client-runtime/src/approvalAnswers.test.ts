import { describe, expect, it } from "vite-plus/test";

import {
  APPROVAL_SWAP_GUARD_MS,
  approvalActivationAllowed,
  approvalAnswerAnnouncement,
  firstUnansweredRequest,
  pruneAnsweredRequestIds,
} from "./approvalAnswers.ts";

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
