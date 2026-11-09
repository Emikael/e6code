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

/**
 * A running turn parked until a usage limit resets: no progress and no action
 * needed. Thread lists on every client show it as Paused rather than Working.
 */
export function isPausedForUsageLimit(thread: {
  readonly session?: { readonly status: string } | null | undefined;
  readonly agentState?: ThreadAgentState | null | undefined;
}): boolean {
  return thread.session?.status === "running" && thread.agentState?.kind === "rate-limited";
}

/** The plan fields a status row needs from `OrchestrationThreadShell.planProgress`. */
interface PlanStepProgress {
  readonly completedSteps: number;
  readonly totalSteps: number;
}

/**
 * Position of the step in progress, `step 4 of 6`, or null without a plan.
 * The running step is the one after the completed ones, capped at the total
 * so a plan whose last step is done still reads `step 6 of 6`.
 */
export function formatPlanStepPosition(
  planProgress: PlanStepProgress | null | undefined,
): string | null {
  if (!planProgress || planProgress.totalSteps <= 0) return null;
  const step = Math.min(planProgress.completedSteps + 1, planProgress.totalSteps);
  return `step ${step} of ${planProgress.totalSteps}`;
}

/**
 * Compact status for a thread row (web sidebar, mobile thread list): a short
 * leading word plus optional detail. Rows render the label at full strength
 * and let the detail truncate; {@link joinThreadRowStatus} is the full text
 * for tooltips and screen readers.
 */
export interface ThreadRowStatusText {
  readonly label: string;
  readonly detail: string | null;
}

/**
 * Row status for a working or paused thread. The agent state wins over the
 * plan step, because it explains why progress stalled: `Waiting for usage
 * limit · resets 14:20`, `Retrying · attempt 2 of 10`, `Compacting`, else
 * `Working · step 4 of 6`.
 * `formatResetTime` renders a usage-limit reset in the viewer's clock format;
 * an empty result drops the detail.
 */
export function formatRunningThreadStatus(input: {
  readonly agentState: ThreadAgentState | null | undefined;
  readonly planProgress: PlanStepProgress | null | undefined;
  readonly formatResetTime: (resetsAt: string) => string;
}): ThreadRowStatusText {
  const { agentState } = input;
  switch (agentState?.kind) {
    case "rate-limited": {
      const resetTime =
        agentState.resetsAt === undefined ? "" : input.formatResetTime(agentState.resetsAt);
      return {
        label: "Waiting for usage limit",
        detail: resetTime === "" ? null : `resets ${resetTime}`,
      };
    }
    case "retrying":
      return {
        label: "Retrying",
        detail:
          agentState.attempt !== undefined && agentState.maxAttempts !== undefined
            ? `attempt ${agentState.attempt} of ${agentState.maxAttempts}`
            : null,
      };
    case "compacting":
      return { label: "Compacting", detail: null };
    case undefined:
      return { label: "Working", detail: formatPlanStepPosition(input.planProgress) };
  }
}

export function joinThreadRowStatus(status: ThreadRowStatusText): string {
  return status.detail === null ? status.label : `${status.label} · ${status.detail}`;
}
