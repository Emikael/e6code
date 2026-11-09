import { PROVIDER_APPROVAL_FEEDBACK_MAX_CHARS } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { approvalFeedbackAgentName, readApprovalFeedbackDraft } from "./approvalFeedback.ts";

describe("approvalFeedbackAgentName", () => {
  it("offers instructions only when the server advertises them", () => {
    expect(
      approvalFeedbackAgentName({ displayName: "Claude", supportsApprovalFeedback: true }),
    ).toBe("Claude");
    expect(approvalFeedbackAgentName({ supportsApprovalFeedback: true })).toBe("the agent");
    expect(approvalFeedbackAgentName({ displayName: "Codex" })).toBeNull();
    expect(approvalFeedbackAgentName(null)).toBeNull();
  });
});

describe("readApprovalFeedbackDraft", () => {
  it("treats whitespace as no instructions, so Decline stays a plain decline", () => {
    expect(readApprovalFeedbackDraft(" \n ")).toEqual({ status: "empty" });
  });

  it("trims instructions like the server", () => {
    expect(readApprovalFeedbackDraft("  use pnpm \n")).toEqual({
      status: "ready",
      feedback: "use pnpm",
    });
  });

  it("flags instructions the server would reject for length", () => {
    expect(
      readApprovalFeedbackDraft(`${"x".repeat(PROVIDER_APPROVAL_FEEDBACK_MAX_CHARS)}   `).status,
    ).toBe("ready");
    expect(readApprovalFeedbackDraft("x".repeat(PROVIDER_APPROVAL_FEEDBACK_MAX_CHARS + 1))).toEqual(
      { status: "too-long", maxChars: PROVIDER_APPROVAL_FEEDBACK_MAX_CHARS },
    );
  });
});
