import {
  answeredPendingIds,
  approvalAnswers,
  approvalAnswersKey,
} from "@e6tools/client-runtime/approval-answers";
import type { ApprovalRequestId, EnvironmentId, ThreadId } from "@e6tools/contracts";
import { useEffect, useMemo, useSyncExternalStore } from "react";

const NO_THREAD = "";

/**
 * One thread's answered approvals, from the client-wide answer store that
 * web reads too, so a request answered on Home is not answerable again in the
 * thread (or after a card remounts) until the provider resolves it.
 * `pendingKnown` is false while the detail loads, so an empty list then does
 * not forget answers.
 */
export function useApprovalAnswers(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly pendingRequestIds: ReadonlyArray<ApprovalRequestId>;
  readonly pendingKnown: boolean;
}) {
  const { environmentId, threadId, pendingRequestIds, pendingKnown } = input;
  const key = environmentId && threadId ? approvalAnswersKey(environmentId, threadId) : NO_THREAD;
  const answers = useSyncExternalStore(approvalAnswers.subscribe, () =>
    approvalAnswers.forThread(key),
  );
  useEffect(() => {
    if (key !== NO_THREAD && pendingKnown) approvalAnswers.prune(key, pendingRequestIds);
  }, [key, pendingKnown, pendingRequestIds]);
  const answered = useMemo(
    () => answeredPendingIds(answers, pendingRequestIds),
    [answers, pendingRequestIds],
  );
  return { key, answers, answered };
}

/**
 * Sends one answer through the shared store: nothing is sent when any
 * surface already answered the request, and a failed answer frees it again.
 */
export async function sendApprovalAnswer<R extends { readonly _tag: string }>(
  key: string,
  requestId: ApprovalRequestId,
  send: () => Promise<R>,
): Promise<R | undefined> {
  if (key === NO_THREAD || !approvalAnswers.begin(key, requestId)) return undefined;
  const result = await send();
  approvalAnswers.settle(key, requestId, result._tag === "Success");
  return result;
}
