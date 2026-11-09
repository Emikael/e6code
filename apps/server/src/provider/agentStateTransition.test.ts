import {
  EventId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { agentStateTransition } from "./agentStateTransition.ts";

const base = {
  eventId: EventId.make("evt"),
  provider: ProviderDriverKind.make("claudeAgent"),
  threadId: ThreadId.make("thread-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

const sessionState = (
  state: "running" | "waiting" | "ready" | "stopped" | "error",
  agentState?: { readonly kind: "compacting" } | null,
): ProviderRuntimeEvent => ({
  ...base,
  type: "session.state.changed",
  payload: { state, ...(agentState !== undefined ? { agentState } : {}) },
});

describe("agentStateTransition", () => {
  it("lets heartbeats pass but ends the state when the session stops running", () => {
    expect(agentStateTransition(sessionState("running", { kind: "compacting" }))).toEqual({
      state: { kind: "compacting" },
    });
    expect(agentStateTransition(sessionState("running"))).toBeNull();
    expect(agentStateTransition(sessionState("waiting"))).toBeNull();
    expect(agentStateTransition(sessionState("running", null))).toEqual({ state: null });
    for (const state of ["ready", "stopped", "error"] as const) {
      expect(agentStateTransition(sessionState(state))).toEqual({ state: null });
    }
  });

  it("clears on completed compaction but ignores other thread state changes", () => {
    const threadState = (state: "compacted" | "active"): ProviderRuntimeEvent => ({
      ...base,
      type: "thread.state.changed",
      payload: { state },
    });
    expect(agentStateTransition(threadState("compacted"))).toEqual({ state: null });
    expect(agentStateTransition(threadState("active"))).toBeNull();
  });

  it("leaves the state alone for warnings and usage updates", () => {
    expect(
      agentStateTransition({ ...base, type: "runtime.warning", payload: { message: "Retrying" } }),
    ).toBeNull();
  });
});
