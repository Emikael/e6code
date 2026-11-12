import { describe, expect, it } from "vite-plus/test";

import {
  approvalMoreLabel,
  DEFAULT_APPROVAL_OPTIONS,
  layoutApprovalActions,
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
