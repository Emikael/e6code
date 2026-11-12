/**
 * Rules for answering approvals away from the thread (web's start screen,
 * mobile's Home): a request answered here stays hidden until the provider
 * resolves it, a request swapped in under the pointer ignores clicks for a
 * moment, and the answer is announced once the card disappears.
 */
import type { ProviderApprovalDecision } from "@e6tools/contracts";

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
