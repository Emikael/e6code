/**
 * Rules for answering approvals, shared by every surface that answers one
 * (web's start screen and thread, mobile's Home and thread): a request is
 * answered once wherever it shows, a request swapped in under the pointer
 * ignores clicks for a moment, a request is only answered away from its
 * thread when all of it can be read there, and both clients offer exactly the
 * options the provider offers.
 */
import type {
  ApprovalRequestId,
  EnvironmentId,
  ProviderApprovalDecision,
  ProviderApprovalOption,
  ThreadId,
} from "@e6tools/contracts";

import { classifyDestructiveApproval, type DestructiveCommand } from "./destructiveCommands.ts";
import type { PendingApproval } from "./pendingRequests.ts";

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

/** "Sent. Waiting for Codex.": an answered request until the provider resolves it. */
export function approvalSentLabel(agent: string): string {
  return `Sent. Waiting for ${agent}.`;
}

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
  /** Null when the provider offers no decline. */
  readonly decline: ProviderApprovalOption | null;
  /** Everything else, for a More menu: "Always allow this session", Cancel, provider extras. */
  readonly more: ReadonlyArray<ProviderApprovalOption>;
}

/**
 * Splits a request's options into Approve, Decline and the More menu, the
 * same way on every surface. A destructive command is allowed one hold at a
 * time and never for the session, so its session-wide allowances are dropped
 * rather than moved to More.
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
 * The most a request's detail may hold to be answered away from its thread:
 * it must fit the card whole, so nobody approves what they did not read.
 */
export const AWAY_APPROVAL_MAX_LINES = 8;
export const AWAY_APPROVAL_MAX_CHARS = 480;

/**
 * Whether a request can be answered away from its thread (web's start
 * screen, mobile's Home), and how:
 * - `answer`: the detail fits whole; Approve is a plain button.
 * - `hold`: destructive; Approve is a hold (web). A surface without
 *   hold-to-allow treats it as `open-thread`.
 * - `open-thread`: the detail is longer than the card shows whole, so the
 *   card only opens the thread, where all of it can be read.
 */
export type AwayApprovalVerdict =
  | { readonly kind: "answer" }
  | { readonly kind: "hold"; readonly destructive: DestructiveCommand }
  | { readonly kind: "open-thread"; readonly reason: "too-long" };

export function approvalAwayFromThread(
  approval: Pick<PendingApproval, "requestKind" | "detail">,
): AwayApprovalVerdict {
  const detail = approval.detail ?? "";
  if (
    detail.length > AWAY_APPROVAL_MAX_CHARS ||
    detail.split("\n").length > AWAY_APPROVAL_MAX_LINES
  ) {
    return { kind: "open-thread", reason: "too-long" };
  }
  const destructive = classifyDestructiveApproval(approval);
  return destructive === null ? { kind: "answer" } : { kind: "hold", destructive };
}

type AnswerState = "sending" | "sent";
type ThreadAnswers = ReadonlyMap<ApprovalRequestId, AnswerState>;
const NO_ANSWERS: ThreadAnswers = new Map();

/** The key the answered store files a thread under. */
export function approvalAnswersKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}

/**
 * Which requests are being answered or were answered, per thread, for every
 * surface on this client at once. The provider's resolution arrives after the
 * answer is acknowledged; until then the request stays pending, and a request
 * answered on one surface must not be answerable on another, or after a card
 * remounts. An entry stays until the request leaves the pending list.
 */
export function createApprovalAnswerStore() {
  const threads = new Map<string, ThreadAnswers>();
  const listeners = new Set<() => void>();
  const write = (key: string, next: ThreadAnswers) => {
    if (next.size === 0) threads.delete(key);
    else threads.set(key, next);
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The thread's answered requests; the same map until one of them changes. */
    forThread(key: string): ThreadAnswers {
      return threads.get(key) ?? NO_ANSWERS;
    },
    /**
     * Claims a request before its answer is sent. False when any surface
     * already sent or is sending one, so a second answer never leaves.
     */
    begin(key: string, requestId: ApprovalRequestId): boolean {
      const current = threads.get(key) ?? NO_ANSWERS;
      if (current.has(requestId)) return false;
      write(key, new Map(current).set(requestId, "sending"));
      return true;
    },
    /** Acknowledged: the request stays answered. Failed: it can be answered again. */
    settle(key: string, requestId: ApprovalRequestId, acknowledged: boolean): void {
      const current = threads.get(key);
      if (!current?.has(requestId)) return;
      const next = new Map(current);
      if (acknowledged) next.set(requestId, "sent");
      else next.delete(requestId);
      write(key, next);
    },
    /**
     * Forgets answered requests that left the pending list. Call only with a
     * loaded thread's list: an empty list while loading would forget them.
     * Requests still sending are kept.
     */
    prune(key: string, pendingIds: ReadonlyArray<ApprovalRequestId>): void {
      const current = threads.get(key);
      if (!current) return;
      const pending = new Set(pendingIds);
      const kept = new Map(
        [...current].filter(([id, state]) => state === "sending" || pending.has(id)),
      );
      if (kept.size !== current.size) write(key, kept);
    },
  };
}

export type ApprovalAnswerStore = ReturnType<typeof createApprovalAnswerStore>;

/** The one store every surface on this client reads. */
export const approvalAnswers = createApprovalAnswerStore();

/** A thread's answered (or answering) ids among those still pending. */
export function answeredPendingIds(
  answers: ThreadAnswers,
  pendingIds: ReadonlyArray<ApprovalRequestId>,
): ReadonlySet<ApprovalRequestId> {
  if (answers.size === 0) return new Set();
  return new Set(pendingIds.filter((id) => answers.has(id)));
}
