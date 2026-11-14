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

  it("sends a destructive command to the thread, and so when nothing is loaded", () => {
    expect(homeApprovalCardModel({ ...base, approvals: [approval("a", "rm -rf /")] }).kind).toBe(
      "open-thread",
    );
    expect(homeApprovalCardModel({ ...base, approvals: [] }).kind).toBe("open-thread");
  });

  it("answers a multi-line command here, and only opens the thread for one too long to show whole", () => {
    const fits = homeApprovalCardModel({
      ...base,
      approvals: [approval("a", "cd apps/web\nvp test run\nvp lint src")],
    });
    expect(fits.kind).toBe("card");
    expect(fits.kind === "card" && fits.what).toBe("cd apps/web");
    const long = Array.from({ length: 20 }, (_, i) => `echo ${i}`).join("\n");
    expect(homeApprovalCardModel({ ...base, approvals: [approval("a", long)] }).kind).toBe(
      "open-thread",
    );
    expect(
      homeApprovalCardModel({ ...base, approvals: [approval("a", "x".repeat(2_000))] }).kind,
    ).toBe("open-thread");
  });

  it("offers exactly what the provider offers", () => {
    const model = homeApprovalCardModel({
      ...base,
      approvals: [approval("a", "pwd", { options: [{ decision: "accept", label: "Allow" }] })],
    });
    expect(model.kind === "card" && model.approve?.label).toBe("Allow");
    expect(model.kind === "card" && model.decline).toBeNull();
    expect(model.kind === "card" && model.more).toEqual([]);
  });

  it("says the answer was sent once every request is answered", () => {
    expect(
      homeApprovalCardModel({
        ...base,
        approvals: [approval("a", "pwd")],
        answered: new Set([ApprovalRequestId.make("a")]),
      }).kind,
    ).toBe("sent");
  });

  it("words an unnamed request generically", () => {
    const model = homeApprovalCardModel({
      ...base,
      provider: "OpenCode",
      approvals: [approval("a", "https://example.com", { unnamedKind: true })],
    });
    expect(model.kind === "card" && model.headline).toBe("OpenCode is waiting for your approval.");
  });
});
