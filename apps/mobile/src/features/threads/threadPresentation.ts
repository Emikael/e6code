import type { StatusTone } from "../../components/StatusPill";
import type { OrchestrationLatestTurn, OrchestrationSession } from "@e6tools/contracts";
import { EnvironmentThreadShell } from "@e6tools/client-runtime/state/shell";
import { isPausedForUsageLimit } from "@e6tools/client-runtime/state/agent-state";

export type ThreadStatusKind =
  | "pending-approval"
  | "awaiting-input"
  | "paused"
  | "working"
  | "connecting"
  | "error"
  | "plan-ready";

export interface ThreadStatusPresentation extends StatusTone {
  readonly kind: ThreadStatusKind;
}

function isLatestTurnSettled(
  latestTurn: OrchestrationLatestTurn | null,
  session: OrchestrationSession | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  return session.status !== "running";
}

/**
 * Resolves the user-facing status of a thread, in priority order. Returns
 * `null` for quiescent threads so rows stay free of "Idle"-style noise.
 * Mirrors `resolveThreadStatusPill` in apps/web/src/components/Sidebar.logic.ts.
 */
export function resolveThreadStatus(
  thread: EnvironmentThreadShell,
): ThreadStatusPresentation | null {
  if (thread.hasPendingApprovals) {
    return {
      kind: "pending-approval",
      label: "Needs approval",
      pillClassName: "bg-warning",
      textClassName: "text-warning-foreground",
    };
  }

  if (thread.hasPendingUserInput) {
    return {
      kind: "awaiting-input",
      label: "Needs your answer",
      pillClassName: "bg-warning",
      textClassName: "text-warning-foreground",
    };
  }

  if (isPausedForUsageLimit(thread)) {
    return {
      kind: "paused",
      label: "Paused",
      // Waiting on the clock, not on the user: neutral, never amber.
      pillClassName: "bg-subtle",
      textClassName: "text-foreground-muted",
    };
  }

  if (thread.session?.status === "running") {
    return {
      kind: "working",
      label: "Working",
      // The accent marks a live agent, matching the web sidebar.
      pillClassName: "bg-primary/10",
      textClassName: "text-primary-text",
    };
  }

  if (thread.session?.status === "starting") {
    return {
      kind: "connecting",
      label: "Connecting",
      pillClassName: "bg-info",
      textClassName: "text-info-foreground",
    };
  }

  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return {
      kind: "error",
      label: "Error",
      pillClassName: "bg-danger",
      textClassName: "text-danger-foreground",
    };
  }

  const hasPlanReadyPrompt =
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      kind: "plan-ready",
      label: "Plan Ready",
      pillClassName: "bg-subtle",
      textClassName: "text-foreground-muted",
    };
  }

  return null;
}
