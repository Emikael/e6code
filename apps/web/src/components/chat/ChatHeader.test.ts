import { DEFAULT_RUNTIME_MODE, EnvironmentId, ThreadId, TurnId } from "@e6tools/contracts";
import { joinThreadRowStatus } from "@e6tools/client-runtime/state/agent-state";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveRenameCommit,
  resolveThreadHeaderStatus,
  shouldShowOpenInPicker,
} from "./ChatHeader";

describe("shouldShowOpenInPicker", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-primary");

  it("shows the picker for projects in the primary environment", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
  });

  it("shows the picker for remote environments in deep-link mode", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(true);
  });

  it("shows the picker's unavailable state for remote environments without an SSH route", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId: null,
        remoteOpenMode: "remote-unavailable",
      }),
    ).toBe(true);
  });

  it("hides the picker for non-primary local backends", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("hides the picker when there is no active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(false);
  });
});

describe("resolveRenameCommit", () => {
  it("commits a trimmed changed title", () => {
    expect(resolveRenameCommit({ title: "  New title ", originalTitle: "Old" })).toEqual({
      action: "commit",
      title: "New title",
    });
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(resolveRenameCommit({ title: "   ", originalTitle: "Old" })).toEqual({
      action: "reject-empty",
    });
  });

  it("no-ops when the trimmed title is unchanged", () => {
    expect(resolveRenameCommit({ title: " Old ", originalTitle: "Old" })).toEqual({
      action: "noop",
    });
  });
});

describe("resolveThreadHeaderStatus", () => {
  const session = {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "Codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: null,
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };
  const completedTurn = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: "2026-03-09T10:00:01.000Z",
    completedAt: "2026-03-09T10:01:00.000Z",
    assistantMessageId: null,
  };
  const idle = {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    session: null,
    latestTurn: null,
  };
  const resolve = (thread: Partial<Parameters<typeof resolveThreadHeaderStatus>[0]>) =>
    resolveThreadHeaderStatus({ ...idle, ...thread }, (resetsAt) =>
      resetsAt === "2026-03-09T14:20:00.000Z" ? "14:20" : "",
    );
  const label = (thread: Partial<Parameters<typeof resolveThreadHeaderStatus>[0]>) =>
    resolve(thread)?.label ?? null;
  const fullText = (thread: Partial<Parameters<typeof resolveThreadHeaderStatus>[0]>) => {
    const status = resolve(thread);
    return status === null ? null : joinThreadRowStatus(status);
  };

  it("carries the plan step and agent-state detail of a running thread", () => {
    const planProgress = { step: "Write tests", completedSteps: 3, totalSteps: 6 };
    expect(fullText({ session, planProgress })).toBe("Working · step 4 of 6");
    expect(
      fullText({
        session,
        planProgress,
        agentState: { kind: "rate-limited", resetsAt: "2026-03-09T14:20:00.000Z" },
      }),
    ).toBe("Paused · resets 14:20");
    expect(
      fullText({ session, agentState: { kind: "retrying", attempt: 2, maxAttempts: 10 } }),
    ).toBe("Retrying · 2 of 10");
    expect(fullText({ session, planProgress, agentState: { kind: "compacting" } })).toBe(
      "Compacting",
    );
    expect(resolve({ session, agentState: { kind: "compacting" } })?.kind).toBe("working");
    expect(fullText({ hasPendingApprovals: true, session, planProgress })).toBe("Needs approval");
  });

  it("follows the sidebar's priorities with full wording", () => {
    expect(label({ hasPendingApprovals: true, hasPendingUserInput: true, session })).toBe(
      "Needs approval",
    );
    expect(label({ hasPendingUserInput: true, session })).toBe("Needs your answer");
    expect(label({ session, agentState: { kind: "rate-limited" } })).toBe("Paused");
    expect(label({ session })).toBe("Working");
    expect(label({ backgroundLiveness: "monitoring" })).toBe("Monitoring");
    expect(label({ session: { ...session, status: "error", lastError: "boom" } })).toBe("Failed");
  });

  it("reads Done only after a completed turn", () => {
    expect(label({ latestTurn: completedTurn })).toBe("Done");
    expect(label({ latestTurn: { ...completedTurn, state: "interrupted" } })).toBeNull();
    expect(label({})).toBeNull();
  });
});
