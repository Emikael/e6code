import type { EnvironmentConnectionPhase } from "@e6tools/client-runtime/connection";
import { formatPlanStepPosition } from "@e6tools/client-runtime/state/agent-state";
import type { ThreadAgentState } from "@e6tools/contracts";

/** Board 9's step meter: one segment per step, done, live or still to come. */
export interface PlanMeter {
  /** "Step 3 of 5". */
  readonly label: string;
  /** Empty past {@link PLAN_METER_MAX_SEGMENTS} steps; the label still says where it is. */
  readonly segments: ReadonlyArray<"done" | "live" | "todo">;
}

/** More steps than this would not fit the pill, so only the words remain. */
export const PLAN_METER_MAX_SEGMENTS = 8;

/** The meter for a reported plan, or null when the agent reports none (OpenCode never does). */
export function planMeter(
  planProgress: { readonly completedSteps: number; readonly totalSteps: number } | null | undefined,
): PlanMeter | null {
  const position = formatPlanStepPosition(planProgress);
  if (!planProgress || position === null) return null;
  const { completedSteps, totalSteps } = planProgress;
  const segments =
    totalSteps > PLAN_METER_MAX_SEGMENTS
      ? []
      : Array.from({ length: totalSteps }, (_, index) =>
          index < completedSteps ? "done" : index === completedSteps ? "live" : "todo",
        );
  return { label: `${position.charAt(0).toUpperCase()}${position.slice(1)}`, segments };
}

/**
 * What the floating pill says. Connection, syncing, and working share one
 * element so the label swaps in place instead of one pill fading out for
 * another. The connection variant is tappable and triggers a reconnect.
 */
export type FloatingWorkingStatus =
  | {
      readonly kind: "working";
      readonly startedAt: string;
      /** The plan the agent reports, for the step meter (F5); absent without one. */
      readonly plan?: PlanMeter;
      /** Opens Run details, which leads with the plan's steps (board 9's chevron). */
      readonly onPress?: () => void;
    }
  | { readonly kind: "syncing"; readonly label: string }
  | { readonly kind: "compacting" }
  // What the running agent reports: compacting, retrying, or paused.
  | { readonly kind: "agent-state"; readonly agentState: ThreadAgentState }
  // A task whose thread the server has not created yet: the worktree may
  // still be checking out, so there is no turn to time.
  | { readonly kind: "preparing"; readonly label: string }
  | {
      readonly kind: "attention";
      readonly tone: "approval" | "input";
      readonly label: string;
      readonly onPress: () => void;
    }
  | {
      readonly kind: "connection";
      readonly tone: "reconnecting" | "unavailable";
      readonly label: string;
      readonly onPress: () => void;
    };

/**
 * High-signal attention cue shown when the user scrolls away from the bottom
 * while a blocking approval or user-input request is waiting at the turn end.
 */
export function pendingAttentionFloatingStatus(input: {
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly showScrollToEnd: boolean;
  readonly onPress: () => void;
}): FloatingWorkingStatus | null {
  if (!input.showScrollToEnd) {
    return null;
  }
  if (input.hasPendingApproval) {
    return {
      kind: "attention",
      tone: "approval",
      label: "Needs approval",
      onPress: input.onPress,
    };
  }
  if (input.hasPendingUserInput) {
    return {
      kind: "attention",
      tone: "input",
      label: "Needs your answer",
      onPress: input.onPress,
    };
  }
  return null;
}

/**
 * The pill once the feed is ready: a requested /compact describes the whole
 * turn, then what the agent reports about itself, then the working timer.
 * The agent state only shows while the turn runs.
 */
export function activeWorkFloatingStatus(input: {
  readonly isCompacting: boolean;
  readonly agentState: ThreadAgentState | null | undefined;
  readonly activeWorkStartedAt: string | null;
  readonly planProgress?:
    | { readonly completedSteps: number; readonly totalSteps: number }
    | null
    | undefined;
  /** Opens Run details, where the plan's steps are. */
  readonly onOpenRunDetails?: () => void;
}): FloatingWorkingStatus | null {
  if (input.isCompacting) {
    return { kind: "compacting" };
  }
  if (input.activeWorkStartedAt === null) {
    return null;
  }
  if (input.agentState) {
    return { kind: "agent-state", agentState: input.agentState };
  }
  const plan = planMeter(input.planProgress);
  return {
    kind: "working",
    startedAt: input.activeWorkStartedAt,
    ...(plan === null ? {} : { plan }),
    ...(input.onOpenRunDetails ? { onPress: input.onOpenRunDetails } : {}),
  };
}

/**
 * The pill's connection variant, or null once the environment is connected and
 * the pill is free to report sync and working state instead.
 */
export function connectionFloatingStatus(input: {
  readonly connectionError: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly environmentLabel: string | null;
  readonly onReconnect: () => void;
}): FloatingWorkingStatus | null {
  const environmentLabel = input.environmentLabel ?? "Environment";
  const unavailable = (label: string): FloatingWorkingStatus => ({
    kind: "connection",
    tone: "unavailable",
    label,
    onPress: input.onReconnect,
  });

  switch (input.connectionState) {
    case "connecting":
    case "reconnecting":
      return {
        kind: "connection",
        tone: "reconnecting",
        label:
          input.connectionError === null
            ? `Reconnecting to ${environmentLabel}...`
            : `Failed to connect. Retrying ${environmentLabel}...`,
        onPress: input.onReconnect,
      };
    case "offline":
      return unavailable("You are offline");
    case "unsupported":
      return unavailable("Client not supported");
    case "error":
      return unavailable(
        input.connectionError
          ? `Failed to connect to ${environmentLabel}: ${input.connectionError}`
          : `Failed to connect to ${environmentLabel}`,
      );
    case "available":
      return unavailable(`${environmentLabel} is not connected`);
    case "connected":
      return null;
  }
}
