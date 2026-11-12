import { describe, expect, it } from "vite-plus/test";

import {
  summarizePendingRequests,
  truncatePendingQuestion,
} from "./ThreadPendingRequestSummary.ts";

describe("summarizePendingRequests", () => {
  it("is null when nothing is pending", () => {
    expect(summarizePendingRequests({ approvals: [], userInputs: [] })).toBeNull();
  });

  it("names the oldest approval's kind and counts that kind", () => {
    expect(
      summarizePendingRequests({
        approvals: [
          { requestKind: null, requestType: "apply_patch_approval" },
          { requestKind: "file-change", requestType: null },
          { requestKind: "command", requestType: "command_execution_approval" },
        ],
        userInputs: [],
      }),
    ).toEqual({
      approvalCount: 3,
      approvalKind: "file-change",
      approvalKindCount: 2,
      userInputCount: 0,
      questionCount: 0,
    });
  });

  it("leaves an approval it cannot name unnamed", () => {
    expect(
      summarizePendingRequests({
        approvals: [{ requestKind: null, requestType: "dynamic_tool_call" }],
        userInputs: [],
      }),
    ).toEqual({ approvalCount: 1, userInputCount: 0, questionCount: 0 });
  });

  it("counts every question and keeps the oldest request's first one", () => {
    expect(
      summarizePendingRequests({
        approvals: [],
        userInputs: [{ questions: ["Spring or fade?", "Which easing?"] }, { questions: ["Ship?"] }],
      }),
    ).toEqual({
      approvalCount: 0,
      userInputCount: 2,
      questionCount: 3,
      question: "Spring or fade?",
    });
  });
});

describe("truncatePendingQuestion", () => {
  it("keeps one line and cuts long text with an ellipsis", () => {
    expect(truncatePendingQuestion("  Spring\n or   fade? ")).toBe("Spring or fade?");
    expect(truncatePendingQuestion("   ")).toBeNull();
    const cut = truncatePendingQuestion("a".repeat(300));
    expect(cut).toHaveLength(160);
    expect(cut?.endsWith("…")).toBe(true);
  });
});
