import {
  answeredPendingIds,
  approvalAnswers,
  approvalAnswersKey,
  classifyApprovalAnswer,
} from "@e6tools/client-runtime/approval-answers";
import {
  type AtomCommandResult,
  reportAtomCommandResult,
} from "@e6tools/client-runtime/state/runtime";
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
  const answers = useSyncExternalStore(...approvalAnswers.threadSource(key));
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
 * surface already answered the request. An answer the server refuses because
 * another one got there first keeps the request answered and reports
 * nothing; any other failure frees it again and is reported under `label`.
 * Send with failure reporting off, so the refusal is not reported first.
 */
export async function sendApprovalAnswer<R extends AtomCommandResult<unknown, unknown>>(
  key: string,
  requestId: ApprovalRequestId,
  label: string,
  send: () => Promise<R>,
): Promise<R | undefined> {
  if (key === NO_THREAD || !approvalAnswers.begin(key, requestId)) return undefined;
  const result = await send();
  const outcome = classifyApprovalAnswer(result);
  approvalAnswers.settle(key, requestId, outcome);
  // Defects were already reported by the command itself.
  if (outcome === "failed") reportAtomCommandResult(result, { label, reportDefect: false });
  return result;
}
