import { describe, expect, it, vi } from "vite-plus/test";

import {
  activeWorkFloatingStatus,
  connectionFloatingStatus,
  pendingAttentionFloatingStatus,
  planMeter,
} from "./floating-working-status";

describe("activeWorkFloatingStatus", () => {
  const startedAt = "2026-01-01T00:00:00.000Z";
  const retrying = { kind: "retrying", attempt: 2, maxAttempts: 5 } as const;

  it("names the agent state instead of the working timer while the turn runs", () => {
    expect(
      activeWorkFloatingStatus({
        isCompacting: false,
        agentState: retrying,
        activeWorkStartedAt: startedAt,
      }),
    ).toEqual({ kind: "agent-state", agentState: retrying });
    expect(
      activeWorkFloatingStatus({
        isCompacting: false,
        agentState: undefined,
        activeWorkStartedAt: startedAt,
      }),
    ).toEqual({ kind: "working", startedAt });
  });

  it("opens Run details from the working bar when asked to", () => {
    const onOpenRunDetails = () => undefined;
    expect(
      activeWorkFloatingStatus({
        isCompacting: false,
        agentState: undefined,
        activeWorkStartedAt: startedAt,
        planProgress: { completedSteps: 2, totalSteps: 5 },
        onOpenRunDetails,
      }),
    ).toMatchObject({
      kind: "working",
      plan: { label: "Step 3 of 5" },
      onPress: onOpenRunDetails,
    });
  });

  it("keeps a requested /compact ahead of what the agent reports", () => {
    expect(
      activeWorkFloatingStatus({
        isCompacting: true,
        agentState: { kind: "compacting" },
        activeWorkStartedAt: startedAt,
      }),
    ).toEqual({ kind: "compacting" });
  });

  it("drops a leftover agent state once no turn is running", () => {
    expect(
      activeWorkFloatingStatus({
        isCompacting: false,
        agentState: { kind: "rate-limited" },
        activeWorkStartedAt: null,
      }),
    ).toBeNull();
  });
});

const status = (
  connectionState: Parameters<typeof connectionFloatingStatus>[0]["connectionState"],
  overrides: { connectionError?: string | null; environmentLabel?: string | null } = {},
) =>
  connectionFloatingStatus({
    connectionError: overrides.connectionError ?? null,
    connectionState,
    environmentLabel:
      overrides.environmentLabel === undefined ? "Mac mini" : overrides.environmentLabel,
    onReconnect: () => {},
  });

describe("connectionFloatingStatus", () => {
  it("yields the pill to sync and working state once connected", () => {
    expect(status("connected")).toBeNull();
  });

  it("names the environment it is retrying, and says so only after a failure", () => {
    expect(status("connecting")).toMatchObject({
      tone: "reconnecting",
      label: "Reconnecting to Mac mini...",
    });
    expect(status("reconnecting", { connectionError: "ECONNREFUSED" })).toMatchObject({
      tone: "reconnecting",
      label: "Failed to connect. Retrying Mac mini...",
    });
  });

  it("reports why the environment is unreachable", () => {
    expect(status("offline")).toMatchObject({
      tone: "unavailable",
      label: "You are offline",
    });
    expect(status("available")).toMatchObject({
      tone: "unavailable",
      label: "Mac mini is not connected",
    });
    expect(status("error", { connectionError: "handshake timed out" })).toMatchObject({
      label: "Failed to connect to Mac mini: handshake timed out",
    });
    expect(status("error")).toMatchObject({ label: "Failed to connect to Mac mini" });
  });

  it("falls back to a generic name when the environment has no label", () => {
    expect(status("error", { environmentLabel: null })).toMatchObject({
      label: "Failed to connect to Environment",
    });
  });

  it("carries the reconnect handler so the pill can trigger it", () => {
    const onReconnect = vi.fn();
    const pill = connectionFloatingStatus({
      connectionError: null,
      connectionState: "offline",
      environmentLabel: "Mac mini",
      onReconnect,
    });
    if (pill?.kind !== "connection") throw new Error("expected a connection pill");
    pill.onPress();
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});

describe("pendingAttentionFloatingStatus", () => {
  it("stays hidden while the user is at the live end of the feed", () => {
    expect(
      pendingAttentionFloatingStatus({
        hasPendingApproval: true,
        hasPendingUserInput: false,
        showScrollToEnd: false,
        onPress: () => {},
      }),
    ).toBeNull();
  });

  it("surfaces approval and question badges when scrolled away from the bottom", () => {
    const onPress = vi.fn();
    const approvalPill = pendingAttentionFloatingStatus({
      hasPendingApproval: true,
      hasPendingUserInput: false,
      showScrollToEnd: true,
      onPress,
    });
    expect(approvalPill).toMatchObject({
      kind: "attention",
      tone: "approval",
      label: "Needs approval",
    });
    if (approvalPill?.kind !== "attention") throw new Error("expected an attention pill");
    approvalPill.onPress();
    expect(onPress).toHaveBeenCalledOnce();

    const inputPill = pendingAttentionFloatingStatus({
      hasPendingApproval: false,
      hasPendingUserInput: true,
      showScrollToEnd: true,
      onPress,
    });
    expect(inputPill).toMatchObject({
      kind: "attention",
      tone: "input",
      label: "Needs your answer",
    });
  });
});

describe("planMeter", () => {
  it("draws board 9's meter: done steps, the live one, then the rest", () => {
    expect(planMeter({ completedSteps: 2, totalSteps: 5 })).toEqual({
      label: "Step 3 of 5",
      segments: ["done", "done", "live", "todo", "todo"],
    });
  });

  it("keeps the words without a meter for long plans, and nothing without a plan", () => {
    expect(planMeter({ completedSteps: 3, totalSteps: 12 })).toEqual({
      label: "Step 4 of 12",
      segments: [],
    });
    expect(planMeter(null)).toBeNull();
    expect(planMeter({ completedSteps: 0, totalSteps: 0 })).toBeNull();
  });

  it("rides on the working status while the agent reports a plan", () => {
    expect(
      activeWorkFloatingStatus({
        isCompacting: false,
        agentState: undefined,
        activeWorkStartedAt: "2026-01-01T00:00:00.000Z",
        planProgress: { completedSteps: 0, totalSteps: 2 },
      }),
    ).toEqual({
      kind: "working",
      startedAt: "2026-01-01T00:00:00.000Z",
      plan: { label: "Step 1 of 2", segments: ["live", "todo"] },
    });
  });
});
