import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import type {
  ApprovalRequestId,
  EnvironmentId,
  ProviderApprovalDecision,
  ThreadId,
} from "@e6tools/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { threadEnvironment } from "~/state/threads";
import { approvalActivationAllowed, pruneAnsweredRequestIds } from "./approvalActions";

const NO_ANSWERED: ReadonlySet<ApprovalRequestId> = new Set();

/**
 * Answers one thread's approval requests, for the thread view and the start
 * screen's approval card. `respondingRequestIds` holds the requests whose
 * answer is in flight, or was acknowledged while the request is still in
 * `pendingRequestIds` (the provider's resolution has not arrived yet), so
 * their buttons stay disabled until the request leaves. A failure reaches
 * `onError` with a readable message.
 */
export function useApprovalResponder(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** The thread's pending approval ids, from its detail. */
  readonly pendingRequestIds: ReadonlyArray<ApprovalRequestId>;
  readonly onError: (threadId: ThreadId, message: string) => void;
}) {
  const { environmentId, threadId, pendingRequestIds, onError } = input;
  const respondToThreadApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const [inFlightRequestIds, setInFlightRequestIds] = useState<ApprovalRequestId[]>([]);
  const [answeredRequestIds, setAnsweredRequestIds] = useState(NO_ANSWERED);

  const respond = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision, feedback?: string) => {
      if (!threadId) return;
      setInFlightRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const result = await respondToThreadApproval({
        environmentId,
        input: {
          threadId,
          requestId,
          decision,
          ...(feedback !== undefined ? { feedback } : {}),
        },
      });
      if (result._tag === "Success") {
        setAnsweredRequestIds((answered) => new Set(answered).add(requestId));
      } else if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        onError(
          threadId,
          error instanceof Error ? error.message : "Failed to submit approval decision.",
        );
      }
      setInFlightRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    },
    [environmentId, onError, respondToThreadApproval, threadId],
  );

  // Answered ids matter only while their request is still pending.
  const answeredStillPending = useMemo(
    () => pruneAnsweredRequestIds(answeredRequestIds, pendingRequestIds),
    [answeredRequestIds, pendingRequestIds],
  );
  const respondingRequestIds = useMemo(
    () =>
      answeredStillPending.size === 0
        ? inFlightRequestIds
        : [...new Set([...inFlightRequestIds, ...answeredStillPending])],
    [answeredStillPending, inFlightRequestIds],
  );

  return { respondingRequestIds, answeredRequestIds: answeredStillPending, respond };
}

/**
 * Guards approval buttons against a request swapped in under the pointer:
 * `allowed()` is false for a moment after `requestId` changes (or first
 * shows). Key the buttons by the request id as well, so a press that began
 * on the previous request never completes on the new one.
 */
export function useApprovalSwapGuard(requestId: ApprovalRequestId | null): () => boolean {
  const shownAt = useRef(0);
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, [requestId]);
  return useCallback(() => approvalActivationAllowed(shownAt.current, performance.now()), []);
}
