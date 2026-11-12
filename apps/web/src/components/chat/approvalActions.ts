import type { ProviderApprovalOption } from "@e6tools/contracts";

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

// Shared with mobile, so both clients answer by the same rules.
export {
  APPROVAL_SWAP_GUARD_MS,
  approvalActivationAllowed,
  approvalAnsweredLabel,
  approvalAnswerAnnouncement,
  approvalAwayFromThread,
  approvalSentLabel,
  DEFAULT_APPROVAL_OPTIONS,
  firstUnansweredRequest,
  layoutApprovalActions,
  type ApprovalActionLayout,
} from "@e6tools/client-runtime/approval-answers";
