import { ApprovalRequestId } from "@e6tools/contracts";
import type { PendingApproval } from "@e6tools/client-runtime/pending-requests";
import { describe, expect, it } from "vite-plus/test";

import { homeApprovalCardModel } from "./home-approval-card";

const approval = (id: string, detail: string, overrides: Partial<PendingApproval> = {}) =>
  ({
    requestId: ApprovalRequestId.make(id),
    requestKind: "command",
    createdAt: "2026-11-12T10:00:00.000Z",
    detail,
    ...overrides,
  }) satisfies PendingApproval;

const base = {
  answered: new Set<ApprovalRequestId>(),
  provider: "Codex",
  threadTitle: "Fix tunnel",
};

describe("homeApprovalCardModel", () => {
  it("words one request as board 8 does and keeps Cancel in the thread", () => {
    const model = homeApprovalCardModel({
      ...base,
      approvals: [
        approval("a", "vp test run apps/server/src/relay", {
          options: [
            { decision: "accept", label: "Allow once" },
            { decision: "acceptForSession", label: "Always allow this session" },
            { decision: "decline", label: "Deny" },
            { decision: "cancel", label: "Cancel" },
          ],
        }),
      ],
    });
    expect(model.kind === "card" && model.headline).toBe("Codex wants to run 1 command.");
    expect(model.kind === "card" && model.more.map((option) => option.decision)).toEqual([
      "acceptForSession",
    ]);
    expect(model.kind === "card" && model.what).toBe("vp test run apps/server/src/relay");
  });

  it("names the request shown among several, skipping ones answered here", () => {
    const approvals = [approval("a", "pwd"), approval("b", "ls"), approval("c", "date")];
    const model = homeApprovalCardModel({
      ...base,
      approvals,
      answered: new Set([ApprovalRequestId.make("a")]),
    });
    expect(model.kind === "card" && model.approval.requestId).toBe("b");
    expect(model.kind === "card" && model.headline).toBe(
      "Codex wants to run this command · 1 of 2",
    );
  });

  it("sends a destructive command to the thread, and so when nothing is left", () => {
    expect(homeApprovalCardModel({ ...base, approvals: [approval("a", "rm -rf /")] }).kind).toBe(
      "open-thread",
    );
    expect(homeApprovalCardModel({ ...base, approvals: [] }).kind).toBe("open-thread");
  });
});
