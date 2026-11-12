/**
 * The first approval in Home's Needs you section, expanded with its actions
 * (board 8, phase 19). Away from the thread an approval is easy to clear on
 * impulse, so: one request at a time with its place among the others, no
 * approve-all, Cancel (which stops the turn) stays in the thread, and a
 * destructive command is only answered from the thread.
 */
import { firstUnansweredRequest } from "@e6tools/client-runtime/approval-answers";
import { classifyDestructiveApproval } from "@e6tools/client-runtime/destructive-commands";
import {
  describeShownApprovalAsk,
  type PendingApproval,
} from "@e6tools/client-runtime/pending-requests";
import type { ApprovalRequestId, ProviderApprovalOption } from "@e6tools/contracts";

/** What the provider offers beyond Approve and Decline when it sends no options. */
const DEFAULT_MORE_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "acceptForSession", label: "Always allow this session" },
];

export type HomeApprovalCardModel =
  | {
      readonly kind: "card";
      readonly approval: PendingApproval;
      /** "Codex wants to run 1 command.", or "… this command · 1 of 2" among several. */
      readonly headline: string;
      /** For the More menu: provider extras such as "Always allow this session". */
      readonly more: ReadonlyArray<ProviderApprovalOption>;
      /** What the announcement names once answered: the command's first line, else the thread. */
      readonly what: string;
    }
  /** Destructive, or nothing left to answer here: the row opens the thread instead. */
  | { readonly kind: "open-thread" };

export function homeApprovalCardModel(input: {
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly answered: ReadonlySet<ApprovalRequestId>;
  /** "Codex", or "The agent" when the provider is unknown. */
  readonly provider: string;
  readonly threadTitle: string;
}): HomeApprovalCardModel {
  const shown = firstUnansweredRequest(input.approvals, input.answered);
  if (shown === null || classifyDestructiveApproval(shown.request) !== null) {
    return { kind: "open-thread" };
  }
  const approval = shown.request;
  const ask = describeShownApprovalAsk(input.provider, approval.requestKind, shown);
  return {
    kind: "card",
    approval,
    headline: shown.total > 1 ? ask : `${ask}.`,
    more: (approval.options ?? DEFAULT_MORE_OPTIONS).filter(
      (option) =>
        option.decision !== "accept" &&
        option.decision !== "decline" &&
        option.decision !== "cancel",
    ),
    what: approval.detail?.split("\n", 1)[0]?.trim() || input.threadTitle,
  };
}
