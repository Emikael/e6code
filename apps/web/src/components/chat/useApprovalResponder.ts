import {
  answeredPendingIds,
  approvalAnswers,
  approvalAnswersKey,
  classifyApprovalAnswer,
} from "@e6tools/client-runtime/approval-answers";
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { threadEnvironment } from "~/state/threads";
import { approvalActivationAllowed } from "./approvalActions";

const NO_THREAD = "";

/**
 * Answers one thread's approval requests, for the thread view and the start
 * screen's approval card. Answers go through the client's shared answer
 * store, so a request answered on one surface is not answerable on another,
 * or again after a remount: `respondingRequestIds` holds the pending requests
 * whose answer is in flight or settled (the provider's resolution has not
 * arrived yet), and `answers` each one's state. An answer the server refuses
 * because another one got there first keeps the request answered, quietly.
 * Any other failure reaches `onError` with a readable message and frees the
 * request.
 */
export function useApprovalResponder(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** The thread's pending approval ids, from its detail. */
  readonly pendingRequestIds: ReadonlyArray<ApprovalRequestId>;
  /** False while the detail is loading: an empty list then does not mean resolved. */
  readonly pendingKnown: boolean;
  readonly onError: (threadId: ThreadId, message: string) => void;
}) {
  const { environmentId, threadId, pendingRequestIds, pendingKnown, onError } = input;
  const respondToThreadApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const key = threadId ? approvalAnswersKey(environmentId, threadId) : NO_THREAD;
  const answers = useSyncExternalStore(...approvalAnswers.threadSource(key));

  // Forget answers whose request the provider resolved.
  useEffect(() => {
    if (key !== NO_THREAD && pendingKnown) approvalAnswers.prune(key, pendingRequestIds);
  }, [key, pendingKnown, pendingRequestIds]);

  const respond = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision, feedback?: string) => {
      if (!threadId) return;
      const answerKey = approvalAnswersKey(environmentId, threadId);
      // Answered here or on another surface already: never send a second answer.
      if (!approvalAnswers.begin(answerKey, requestId)) return;
      const result = await respondToThreadApproval({
        environmentId,
        input: {
          threadId,
          requestId,
          decision,
          ...(feedback !== undefined ? { feedback } : {}),
        },
      });
      const outcome = classifyApprovalAnswer(result);
      approvalAnswers.settle(answerKey, requestId, outcome);
      if (outcome === "failed" && result._tag !== "Success" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        onError(
          threadId,
          error instanceof Error ? error.message : "Failed to submit approval decision.",
        );
      }
      return result;
    },
    [environmentId, onError, respondToThreadApproval, threadId],
  );

  const answeredRequestIds = useMemo(
    () => answeredPendingIds(answers, pendingRequestIds),
    [answers, pendingRequestIds],
  );
  const respondingRequestIds = useMemo(() => [...answeredRequestIds], [answeredRequestIds]);

  return { respondingRequestIds, answers, answeredRequestIds, respond };
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
