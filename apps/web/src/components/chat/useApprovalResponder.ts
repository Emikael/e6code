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
import { useCallback, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { threadEnvironment } from "~/state/threads";

/**
 * Answers one thread's approval requests, for the thread view and the start
 * screen's approval card. `respondingRequestIds` holds the requests whose
 * answer is in flight, so their buttons disable until the server replies; a
 * failure reaches `onError` with a readable message.
 */
export function useApprovalResponder(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly onError: (threadId: ThreadId, message: string) => void;
}) {
  const { environmentId, threadId, onError } = input;
  const respondToThreadApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);

  const respond = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision, feedback?: string) => {
      if (!threadId) return;
      setRespondingRequestIds((existing) =>
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
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        onError(
          threadId,
          error instanceof Error ? error.message : "Failed to submit approval decision.",
        );
      }
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    },
    [environmentId, onError, respondToThreadApproval, threadId],
  );

  return { respondingRequestIds, respond };
}
