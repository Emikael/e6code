import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  respond: (() => Promise.resolve({ _tag: "Success" })) as (value: unknown) => Promise<unknown>,
}));
vi.mock("~/state/threads", () => ({ threadEnvironment: {} }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => (value: unknown) => fixture.respond(value),
}));

import { approvalAnswers, approvalAnswersKey } from "@e6tools/client-runtime/approval-answers";
import {
  ApprovalRequestId,
  EnvironmentId,
  OrchestrationDispatchCommandError,
  ThreadId,
} from "@e6tools/contracts";
import * as Cause from "effect/Cause";

import { useApprovalResponder } from "./useApprovalResponder";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const answersKey = approvalAnswersKey(environmentId, threadId);

function respond(
  requestId: ApprovalRequestId,
  onError: (threadId: ThreadId, message: string) => void,
) {
  let answer: ReturnType<typeof useApprovalResponder>["respond"] | null = null;
  function Probe() {
    answer = useApprovalResponder({
      environmentId,
      threadId,
      pendingRequestIds: [requestId],
      pendingKnown: true,
      onError,
    }).respond;
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return answer!(requestId, "accept");
}

const refusal = (error: OrchestrationDispatchCommandError) => () =>
  Promise.resolve({ _tag: "Failure", cause: Cause.fail(error) });

describe("useApprovalResponder", () => {
  it("keeps a request answered elsewhere answered, with no error", async () => {
    fixture.respond = refusal(
      new OrchestrationDispatchCommandError({
        message: "This request has already been answered.",
        requestAlreadyAnswered: true,
      }),
    );
    const onError = vi.fn();
    const requestId = ApprovalRequestId.make("approval-elsewhere");
    await respond(requestId, onError);
    expect(approvalAnswers.forThread(answersKey).get(requestId)).toBe("already-answered");
    expect(onError).not.toHaveBeenCalled();
  });

  it("frees a request whose answer failed and says why", async () => {
    fixture.respond = refusal(new OrchestrationDispatchCommandError({ message: "Not running." }));
    const onError = vi.fn();
    const requestId = ApprovalRequestId.make("approval-failed");
    await respond(requestId, onError);
    expect(approvalAnswers.forThread(answersKey).has(requestId)).toBe(false);
    expect(onError).toHaveBeenCalledWith(threadId, "Not running.");
  });
});
