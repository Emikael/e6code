import type { ThreadAgentState } from "@e6tools/contracts";
import { formatDuration } from "@e6tools/shared/usageLimits";

const MINUTE_MS = 60_000;

/**
 * Working-indicator label for what a running agent is doing, shared by web
 * and mobile. `nowMs` only matters for a pause with a known reset: pass a
 * minute-quantized clock so the countdown repaints at most once a minute.
 */
export function formatAgentStateLabel(state: ThreadAgentState, nowMs: number): string {
  switch (state.kind) {
    case "compacting":
      return "Compacting context…";
    case "retrying":
      return state.attempt !== undefined && state.maxAttempts !== undefined
        ? `Retrying request (${state.attempt} of ${state.maxAttempts})…`
        : "Retrying request…";
    case "rate-limited": {
      const waitMs = state.resetsAt === undefined ? Number.NaN : Date.parse(state.resetsAt) - nowMs;
      // Rounded up: "resets in 1m" until the reset, never "resets in 0m".
      return waitMs > 0
        ? `Paused for usage limit · resets in ${formatDuration(Math.ceil(waitMs / MINUTE_MS) * MINUTE_MS)}`
        : "Paused for usage limit";
    }
  }
}

/** Whether the label changes with the clock, so callers subscribe to a ticker only then. */
export function agentStateLabelTicks(state: ThreadAgentState): boolean {
  return state.kind === "rate-limited" && state.resetsAt !== undefined;
}
