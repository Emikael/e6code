import type { ProviderApprovalDecision, ProviderApprovalOption } from "@e6tools/contracts";

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

/**
 * How long a newly shown request ignores clicks. When the shown request is
 * answered elsewhere, the next one takes its place under the pointer; a click
 * already under way must not answer a request the user never read.
 */
export const APPROVAL_SWAP_GUARD_MS = 400;

/** Whether a click may answer a request shown since `shownAtMs`. */
export function approvalActivationAllowed(shownAtMs: number, nowMs: number): boolean {
  return nowMs - shownAtMs >= APPROVAL_SWAP_GUARD_MS;
}

/**
 * Answered requests stay in the thread detail until the provider's resolution
 * arrives, after the command is acknowledged. Keep their ids until they leave
 * the pending list, so an answered request never becomes clickable again.
 * Returns `answered` itself when nothing left.
 */
export function pruneAnsweredRequestIds<Id>(
  answered: ReadonlySet<Id>,
  pendingIds: ReadonlyArray<Id>,
): ReadonlySet<Id> {
  if (answered.size === 0) return answered;
  const pending = new Set(pendingIds);
  const kept = new Set([...answered].filter((id) => pending.has(id)));
  return kept.size === answered.size ? answered : kept;
}

/** The first request not yet answered here, with its place among those still waiting. */
export function firstUnansweredRequest<T extends { readonly requestId: Id }, Id>(
  requests: ReadonlyArray<T>,
  answered: ReadonlySet<Id>,
): { readonly request: T; readonly index: number; readonly total: number } | null {
  const waiting = requests.filter((request) => !answered.has(request.requestId));
  const request = waiting[0];
  return request ? { request, index: 0, total: waiting.length } : null;
}

/**
 * What a polite announcement says once an approval is answered from the start
 * screen, where the card simply disappears: "Approved: vp test run".
 */
export function approvalAnswerAnnouncement(
  decision: ProviderApprovalDecision,
  what: string,
): string {
  const verb =
    decision === "accept" || decision === "acceptForSession" || decision === "acceptAlways"
      ? "Approved"
      : "Declined";
  return `${verb}: ${what}`;
}
