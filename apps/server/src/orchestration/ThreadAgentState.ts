/**
 * ThreadAgentStateService - in-memory per-thread agent state for the Working
 * indicators: compacting, retrying, or paused on a usage limit.
 *
 * Adapters report the state on `session.state.changed`; ingestion records it
 * here and the shell query reads it at mapping time — no persistence, no
 * migration (same pattern as ThreadPlanProgressService). The state is a
 * transient annotation on a running turn, so it clears when the adapter says
 * so, on the next real progress, and when the turn or session ends. After a server restart the registry is empty, which matches reality:
 * the turn it described is gone.
 *
 * @module ThreadAgentStateService
 */
import type { ThreadAgentState } from "@e6tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class ThreadAgentStateService extends Context.Service<
  ThreadAgentStateService,
  {
    /** Records the state; returns whether the thread's state changed. */
    readonly setThreadAgentState: (threadId: string, state: ThreadAgentState | null) => boolean;

    readonly getThreadAgentState: (threadId: string) => ThreadAgentState | null;
  }
>()("e6/orchestration/ThreadAgentState/ThreadAgentStateService") {}

const sameAgentState = (left: ThreadAgentState | null, right: ThreadAgentState | null): boolean =>
  left === right ||
  (left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right));

export function make(): ThreadAgentStateService["Service"] {
  const stateByThreadId = new Map<string, ThreadAgentState>();

  return {
    setThreadAgentState: (threadId, state) => {
      if (sameAgentState(stateByThreadId.get(threadId) ?? null, state)) {
        return false;
      }
      if (state === null) {
        stateByThreadId.delete(threadId);
      } else {
        stateByThreadId.set(threadId, state);
      }
      return true;
    },

    getThreadAgentState: (threadId) => stateByThreadId.get(threadId) ?? null,
  };
}

export const layer = Layer.effect(ThreadAgentStateService, Effect.sync(make));
