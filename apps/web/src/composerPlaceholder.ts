import type { SessionPhase } from "./types";

/** The font preview's sample prompt in Settings. */
export const DISCONNECTED_COMPOSER_PLACEHOLDER =
  "Ask for changes, send follow-ups, or attach images";

const IDLE_COMPOSER_PLACEHOLDER =
  "Ask anything, @tag files/folders, $use skills, or / for commands";

/**
 * What the composer invites next. Blocking states (an approval, a pending question, a plan to
 * refine) win over the turn phase; while a turn runs, a sent message queues for it. A thread
 * with no live session (every draft, and any thread at rest) gets the usual prompt (board 1).
 */
export function resolveComposerPlaceholder(input: {
  readonly approval: { readonly agentName: string | null } | null;
  readonly pendingQuestion: { readonly choiceOnly: boolean } | null;
  readonly planFollowUp: boolean;
  readonly projectSelectionRequired: boolean;
  readonly providerUnavailable: boolean;
  readonly phase: SessionPhase;
  /** Focus mode invites a reply or a parked thought (board 3). */
  readonly focusMode?: boolean;
}): string {
  if (input.approval) {
    return input.approval.agentName !== null
      ? `Tell ${input.approval.agentName} what to do instead…`
      : "Resolve this approval request to continue";
  }
  if (input.pendingQuestion) {
    return input.pendingQuestion.choiceOnly
      ? "Choose an option above"
      : "Type your own answer, or leave this blank to use the selected option";
  }
  if (input.planFollowUp) {
    return "Add feedback to refine the plan, or leave this blank to implement it";
  }
  if (input.projectSelectionRequired) return "Choose a project above to start a thread";
  if (input.providerUnavailable) return "Enable a provider in Settings to send a message";
  if (input.phase === "running") return "Queue a follow-up while it works";
  if (input.focusMode) return "Reply, or park a thought for later";
  return IDLE_COMPOSER_PLACEHOLDER;
}
