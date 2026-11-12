import type { ProviderApprovalOption } from "@e6tools/contracts";

/** What the provider offers when it sends no options of its own. */
export const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export interface ApprovalActionLayout {
  /** Approve: a button, or a hold when the command is destructive. Null when not offered. */
  readonly approve:
    | { readonly kind: "button"; readonly option: ProviderApprovalOption }
    | { readonly kind: "hold"; readonly option: ProviderApprovalOption; readonly reason: string }
    | null;
  readonly decline: ProviderApprovalOption | null;
  /** Everything else, for a More menu: "Always allow this session", Cancel, provider extras. */
  readonly more: ReadonlyArray<ProviderApprovalOption>;
}

/**
 * Splits a request's options into Approve, Decline and the More menu, the
 * same way in the composer and on the start screen. A destructive command is
 * allowed one hold at a time and never for the session, so its session-wide
 * allowances are dropped rather than moved to More.
 */
export function layoutApprovalActions(
  options: ReadonlyArray<ProviderApprovalOption> | undefined,
  destructive: { readonly reason: string } | null,
): ApprovalActionLayout {
  const offered = options ?? DEFAULT_APPROVAL_OPTIONS;
  const accept = offered.find((option) => option.decision === "accept") ?? null;
  return {
    approve:
      accept === null
        ? null
        : destructive !== null
          ? { kind: "hold", option: accept, reason: destructive.reason }
          : { kind: "button", option: accept },
    decline: offered.find((option) => option.decision === "decline") ?? null,
    more: offered.filter(
      (option) =>
        option.decision !== "decline" &&
        option.decision !== "accept" &&
        !(
          destructive !== null &&
          (option.decision === "acceptForSession" || option.decision === "acceptAlways")
        ),
    ),
  };
}

/**
 * The More button's accessible name, naming what it holds:
 * "More: always allow this session, decline with a message".
 */
export function approvalMoreLabel(
  more: ReadonlyArray<ProviderApprovalOption>,
  declineWithMessage: boolean,
): string {
  const items = [
    ...more.map((option) => option.label.toLowerCase()),
    ...(declineWithMessage ? ["decline with a message"] : []),
  ];
  return items.length > 0 ? `More: ${items.join(", ")}` : "More";
}

// Shared with mobile's Home approval card, so both answer by the same rules.
export {
  APPROVAL_SWAP_GUARD_MS,
  approvalActivationAllowed,
  approvalAnswerAnnouncement,
  firstUnansweredRequest,
  pruneAnsweredRequestIds,
} from "@e6tools/client-runtime/approval-answers";
