import { describe, expect, it } from "vite-plus/test";

import { ApprovalRequestId } from "@e6tools/contracts";

import {
  APPROVAL_SWAP_GUARD_MS,
  AWAY_APPROVAL_MAX_CHARS,
  AWAY_APPROVAL_MAX_LINES,
  DEFAULT_APPROVAL_OPTIONS,
  answeredPendingIds,
  approvalActivationAllowed,
  approvalAnswerAnnouncement,
  approvalAwayFromThread,
  approvalSentLabel,
  createApprovalAnswerStore,
  firstUnansweredRequest,
  layoutApprovalActions,
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

describe("answering away from the thread", () => {
  it("answers a multi-line command that fits whole", () => {
    const detail = ["cd apps/web", "vp test run src/a.test.ts", "vp lint src/a.ts"].join("\n");
    expect(approvalAwayFromThread({ requestKind: "command", detail })).toEqual({ kind: "answer" });
  });

  it("only opens the thread for a detail longer than the card shows whole", () => {
    const manyLines = Array.from({ length: AWAY_APPROVAL_MAX_LINES + 1 }, (_, i) => `echo ${i}`);
    expect(
      approvalAwayFromThread({ requestKind: "command", detail: manyLines.join("\n") }),
    ).toEqual({ kind: "open-thread", reason: "too-long" });
    expect(
      approvalAwayFromThread({
        requestKind: "file-change",
        detail: "x".repeat(AWAY_APPROVAL_MAX_CHARS + 1),
      }),
    ).toEqual({ kind: "open-thread", reason: "too-long" });
    // Too long wins over destructive: nothing hidden is held to approve either.
    expect(
      approvalAwayFromThread({
        requestKind: "command",
        detail: `git push -f origin main\n${"echo\n".repeat(AWAY_APPROVAL_MAX_LINES)}`,
      }).kind,
    ).toBe("open-thread");
  });

  it("asks for a hold on a destructive command", () => {
    const verdict = approvalAwayFromThread({
      requestKind: "command",
      detail: "git push -f origin main",
    });
    expect(verdict.kind).toBe("hold");
  });

  it("words an answered request still waiting on the provider", () => {
    expect(approvalSentLabel("Codex")).toBe("Sent. Waiting for Codex.");
  });
});

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

  it("offers no Approve, or no Decline, when the provider does not", () => {
    const noAccept = layoutApprovalActions([{ decision: "decline", label: "Deny" }], null);
    expect(noAccept.approve).toBeNull();
    expect(noAccept.decline?.label).toBe("Deny");
    expect(noAccept.more).toEqual([]);
    const noDecline = layoutApprovalActions([{ decision: "accept", label: "Allow" }], null);
    expect(noDecline.decline).toBeNull();
    expect(noDecline.approve?.option.label).toBe("Allow");
  });
});

describe("approval answer store", () => {
  const a = ApprovalRequestId.make("a");
  const b = ApprovalRequestId.make("b");

  it("lets one surface answer a request once, across surfaces and remounts", () => {
    const store = createApprovalAnswerStore();
    // The start card claims it; the thread view, reading the same store, cannot.
    expect(store.begin("env:t1", a)).toBe(true);
    expect(store.begin("env:t1", a)).toBe(false);
    store.settle("env:t1", a, true);
    expect(store.begin("env:t1", a)).toBe(false);
    expect([...answeredPendingIds(store.forThread("env:t1"), [a, b])]).toEqual([a]);
    // Other threads are separate.
    expect(store.begin("env:t2", a)).toBe(true);
  });

  it("frees a request whose answer failed", () => {
    const store = createApprovalAnswerStore();
    store.begin("env:t1", a);
    store.settle("env:t1", a, false);
    expect(store.forThread("env:t1").size).toBe(0);
    expect(store.begin("env:t1", a)).toBe(true);
  });

  it("forgets an answered request once it leaves the pending list", () => {
    const store = createApprovalAnswerStore();
    let notified = 0;
    store.subscribe(() => notified++);
    store.begin("env:t1", a);
    store.settle("env:t1", a, true);
    store.begin("env:t1", b);
    const before = store.forThread("env:t1");
    store.prune("env:t1", [a, b]);
    // Nothing left: the same map, and no notification.
    expect(store.forThread("env:t1")).toBe(before);
    const count = notified;
    // Resolved: a goes; b is still being sent, so it stays.
    store.prune("env:t1", []);
    expect([...store.forThread("env:t1").keys()]).toEqual([b]);
    expect(notified).toBe(count + 1);
  });

  it("reads empty on a server render, whatever the client has answered", () => {
    const store = createApprovalAnswerStore();
    store.begin("env:t1", a);
    const [, getSnapshot, getServerSnapshot] = store.threadSource("env:t1");
    expect([...getSnapshot().keys()]).toEqual([a]);
    expect(getServerSnapshot().size).toBe(0);
  });
});
