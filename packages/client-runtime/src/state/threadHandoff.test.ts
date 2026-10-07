import { describe, expect, it } from "vite-plus/test";

import {
  buildHandoffDocument,
  buildHandoffTargets,
  buildHandoffTurnInput,
  firstAvailableHandoffTarget,
  isLimitErrorText,
  isProviderExhausted,
  shouldOfferHandoff,
} from "./threadHandoff.ts";

describe("isLimitErrorText", () => {
  it("matches provider limit signals", () => {
    expect(isLimitErrorText("Grok usage limit reached")).toBe(true);
    expect(isLimitErrorText("rate_limit: slow down")).toBe(true);
    expect(isLimitErrorText("429 too many requests")).toBe(true);
    expect(isLimitErrorText("boom")).toBe(false);
  });
});

describe("isProviderExhausted", () => {
  it("treats any full window as exhausted", () => {
    expect(isProviderExhausted({ checkedAt: "2026-10-06T00:00:00.000Z", windows: [] })).toBe(false);
    expect(
      isProviderExhausted({
        checkedAt: "2026-10-06T00:00:00.000Z",
        windows: [{ id: "five_hour", kind: "session", label: "5h", usedPercent: 100 }],
      }),
    ).toBe(true);
  });
});

describe("buildHandoffDocument", () => {
  it("summarizes goal plus recent turns without network", () => {
    const doc = buildHandoffDocument(
      {
        id: "thread-1",
        title: "Fix auth redirect",
        branch: "fix/auth",
        modelLabel: "Claude",
        messages: [
          {
            role: "user",
            text: "Fix the login redirect loop",
            createdAt: "2026-10-06T01:00:00.000Z",
          },
          {
            role: "assistant",
            text: "Found it in middleware",
            createdAt: "2026-10-06T01:01:00.000Z",
          },
          { role: "user", text: "Ship it", createdAt: "2026-10-06T01:02:00.000Z" },
        ],
      },
      { recentCount: 2 },
    );
    expect(doc.markdown).toContain('Continuing from "Fix auth redirect"');
    expect(doc.markdown).toContain("Fix the login redirect loop");
    expect(doc.recent).toHaveLength(2);
  });
});

describe("buildHandoffTurnInput", () => {
  it("creates a new thread turn on the target with the same workspace", () => {
    const input = buildHandoffTurnInput({
      source: {
        projectId: "project-1",
        title: "Fix auth redirect",
        branch: "fix/auth",
        worktreePath: null,
        runtimeMode: "full-access",
        interactionMode: "default",
      },
      handoffMarkdown: "Continuing from x",
      target: { instanceId: "codex", model: "gpt-5.4" },
      ids: {
        threadId: "thread-2",
        commandId: "cmd-1",
        messageId: "msg-1",
        createdAt: "2026-10-06T02:00:00.000Z",
      },
    });
    expect(input.threadId).toBe("thread-2");
    expect(input.message.text).toContain("Continuing from x");
    expect(input.bootstrap?.createThread?.projectId).toBe("project-1");
    expect(input.bootstrap?.createThread?.branch).toBe("fix/auth");
    expect(input.bootstrap?.createThread?.modelSelection.instanceId).toBe("codex");
  });
});

describe("shouldOfferHandoff", () => {
  const limits = (usedPercent: number) => ({
    checkedAt: "2026-10-06T00:00:00.000Z",
    windows: [{ id: "w", kind: "session" as const, label: "w", usedPercent }],
  });
  it("offers on limit error or exhausted windows, not otherwise", () => {
    expect(
      shouldOfferHandoff({ sessionLastError: "usage limit reached", usageLimits: limits(40) }),
    ).toBe(true);
    expect(shouldOfferHandoff({ sessionLastError: null, usageLimits: limits(100) })).toBe(true);
    expect(shouldOfferHandoff({ sessionLastError: "boom", usageLimits: limits(40) })).toBe(false);
    expect(shouldOfferHandoff({ sessionLastError: null, usageLimits: undefined })).toBe(false);
  });
});

describe("firstAvailableHandoffTarget", () => {
  it("skips the source and exhausted providers", () => {
    const target = firstAvailableHandoffTarget(
      [
        { instanceId: "claude", model: "opus", label: "Claude", usedPercent: 100 },
        { instanceId: "codex", model: "gpt-5.4", label: "Codex", usedPercent: 10 },
      ],
      "claude",
    );
    expect(target?.instanceId).toBe("codex");
    expect(firstAvailableHandoffTarget([], "claude")).toBeNull();
  });
});

describe("buildHandoffTargets", () => {
  it("drops the source, marks limited targets, and puts available first", () => {
    const targets = buildHandoffTargets(
      [
        { instanceId: "claude", model: "opus", label: "Claude", usedPercent: 0 },
        { instanceId: "grok", model: "grok-4", label: "Grok", usedPercent: 100 },
        { instanceId: "codex", model: "gpt-5.4", label: "Codex", usedPercent: 20 },
      ],
      "claude",
    );
    expect(targets.map((target) => target.instanceId)).toEqual(["codex", "grok"]);
    expect(targets[0]?.available).toBe(true);
    expect(targets[1]?.available).toBe(false);
  });
});
