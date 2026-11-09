/**
 * Pure agent-state transition rules shared by ingestion, which records the
 * working indicator's state, and adapters that need to know when the state
 * they reported has been cleared.
 *
 * @module agentStateTransition
 */
import type { ProviderRuntimeEvent, ThreadAgentState } from "@e6tools/contracts";

/**
 * How one runtime event moves the agent state: a new state, a clear, or no
 * effect. Progress (streamed text, a tool starting, a request to the user)
 * proves the agent is past whatever it was waiting on.
 */
export function agentStateTransition(
  event: ProviderRuntimeEvent,
): { readonly state: ThreadAgentState | null } | null {
  switch (event.type) {
    case "session.state.changed":
      if (event.payload.agentState !== undefined) {
        return { state: event.payload.agentState };
      }
      // Heartbeats while the agent runs (e.g. a request starting) say nothing
      // about the state; anything that stops the session ends it.
      return event.payload.state === "running" || event.payload.state === "waiting"
        ? null
        : { state: null };
    case "session.started":
    case "session.exited":
    case "turn.started":
    case "turn.completed":
    case "turn.aborted":
    case "content.delta":
    case "item.started":
    case "request.opened":
    case "user-input.requested":
    case "turn.plan.updated":
    case "task.started":
      return { state: null };
    case "thread.state.changed":
      return event.payload.state === "compacted" ? { state: null } : null;
    default:
      return null;
  }
}
