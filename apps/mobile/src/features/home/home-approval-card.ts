/**
 * The first approval in Home's Needs you section, expanded with its actions
 * (board 8, phase 19). Away from the thread an approval is easy to clear on
 * impulse, so: one request at a time with its place among the others, no
 * approve-all, Cancel (which stops the turn) stays in the thread, and only a
 * request whose detail fits the card whole is answered here. A destructive
 * command (which web holds to allow) and a detail too long to show whole are
 * answered in the thread.
 */
import {
  approvalAwayFromThread,
  firstUnansweredRequest,
  layoutApprovalActions,
} from "@e6tools/client-runtime/approval-answers";
import {
  approvalWordingKind,
  describeShownApprovalAsk,
  type PendingApproval,
} from "@e6tools/client-runtime/pending-requests";
import type { ApprovalRequestId, ProviderApprovalOption } from "@e6tools/contracts";

export type HomeApprovalCardModel =
  | {
      readonly kind: "card";
      readonly approval: PendingApproval;
      /** "Codex wants to run 1 command.", or "… this command · 1 of 2" among several. */
      readonly headline: string;
      /** Approve, when the provider offers it. */
      readonly approve: ProviderApprovalOption | null;
      /** Decline, when the provider offers it. */
      readonly decline: ProviderApprovalOption | null;
      /** For the More menu: provider extras such as "Always allow this session". */
      readonly more: ReadonlyArray<ProviderApprovalOption>;
      /** What the confirmation names once answered: the command's first line, else the thread. */
      readonly what: string;
    }
  /** Every request was answered; the provider has not resolved them yet. */
  | { readonly kind: "sent" }
  /** Destructive, too long to show whole, or nothing loaded: the row opens the thread. */
  | { readonly kind: "open-thread" };

export function homeApprovalCardModel(input: {
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly answered: ReadonlySet<ApprovalRequestId>;
  /** "Codex", or "The agent" when the provider is unknown. */
  readonly provider: string;
  readonly threadTitle: string;
}): HomeApprovalCardModel {
  const shown = firstUnansweredRequest(input.approvals, input.answered);
  if (shown === null)
    return input.approvals.length > 0 ? { kind: "sent" } : { kind: "open-thread" };
  const approval = shown.request;
  // Home has no hold-to-allow, so a destructive command goes to the thread too.
  if (approvalAwayFromThread(approval).kind !== "answer") return { kind: "open-thread" };
  const layout = layoutApprovalActions(approval.options, null);
  const ask = describeShownApprovalAsk(input.provider, approvalWordingKind(approval), shown);
  return {
    kind: "card",
    approval,
    headline: shown.total > 1 ? ask : `${ask}.`,
    approve: layout.approve?.option ?? null,
    decline: layout.decline,
    more: layout.more.filter((option) => option.decision !== "cancel"),
    what: approval.detail?.split("\n", 1)[0]?.trim() || input.threadTitle,
  };
}
