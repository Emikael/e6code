import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  drafts: {} as Record<string, unknown>,
  uploads: {} as Record<string, unknown>,
  preparations: {} as Record<string, number>,
  preparationAtom: Symbol("preparation"),
  respond: (() => Promise.resolve({ _tag: "Success" })) as (value: unknown) => Promise<unknown>,
}));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "drafts"
      ? fixture.drafts
      : atom === "uploads"
        ? fixture.uploads
        : atom === fixture.preparationAtom
          ? fixture.preparations
          : {},
}));
vi.mock("./use-composer-drafts", () => ({
  composerDraftsAtom: "drafts",
  clearComposerDraft: vi.fn(),
}));
vi.mock("./composer-attachment-uploads", async () => ({
  ...(await import("../lib/composerAttachmentUploadQueue")),
  composerAttachmentUploadsAtom: "uploads",
}));
vi.mock("./question-attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./question-attachments")>()),
  questionAttachmentPreparationAtom: fixture.preparationAtom,
}));
vi.mock("./entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "environment-1",
        {
          environment: {
            capabilities: {
              questionAttachments: true,
              attachmentUploads: true,
              fileAttachments: { maxUploadBytes: 20_000_000 },
            },
          },
        },
      ],
    ]),
}));
vi.mock("./threads", () => ({ threadEnvironment: {} }));
vi.mock("./use-atom-command", () => ({
  useAtomCommand: () => (value: unknown) => fixture.respond(value),
}));
vi.mock("./use-thread-selection", () => ({
  useThreadSelection: () => ({
    selectedThread: { environmentId: "environment-1", id: "thread-1" },
  }),
}));
vi.mock("./use-thread-detail", () => ({
  useSelectedThreadDetail: () => ({
    activities: [
      {
        id: "request-activity",
        kind: "user-input.requested",
        createdAt: "2026-09-08T00:00:00Z",
        payload: {
          requestId: "request-1",
          questions: ["first", "second"].map((id) => ({
            id,
            header: id,
            question: `Attach ${id} file`,
            options: [],
            allowCustomAnswer: true,
          })),
        },
      },
    ],
  }),
}));

import { approvalAnswers, approvalAnswersKey } from "@e6tools/client-runtime/approval-answers";
import {
  ApprovalRequestId,
  EnvironmentId,
  OrchestrationDispatchCommandError,
  ThreadId,
} from "@e6tools/contracts";
import * as Cause from "effect/Cause";
import { questionAttachmentDraftKey } from "./question-attachments";
import { useSelectedThreadRequests } from "./use-selected-thread-requests";

const environmentId = EnvironmentId.make("environment-1");
const key = (question: string) =>
  questionAttachmentDraftKey(
    environmentId,
    ThreadId.make("thread-1"),
    ApprovalRequestId.make("request-1"),
    question,
  );
function submitButtonMarkup() {
  function Probe() {
    const { activePendingUserInputAnswers } = useSelectedThreadRequests();
    return <button disabled={activePendingUserInputAnswers === null}>Submit answers</button>;
  }
  return renderToStaticMarkup(<Probe />);
}
beforeEach(() => {
  fixture.preparations = {};
  fixture.drafts = Object.fromEntries(
    ["first", "second"].map((id) => [
      key(id),
      {
        attachments: [
          {
            id,
            type: "file",
            name: `${id}.txt`,
            mimeType: "text/plain",
            sizeBytes: 4,
            fileUri: `file:///${id}.txt`,
          },
        ],
      },
    ]),
  );
  fixture.uploads = { "environment-1:first": { status: "ready" } };
});
describe("question attachment submission readiness", () => {
  it.each([
    undefined,
    { status: "uploading", progress: 0.5 },
    { status: "failed", reason: "Offline" },
  ])("keeps Submit disabled until all question uploads finish: %j", (state) => {
    if (state) fixture.uploads["environment-1:second"] = state;
    expect(submitButtonMarkup()).toContain("disabled");
    fixture.uploads["environment-1:second"] = { status: "ready" };
    expect(submitButtonMarkup()).not.toContain("disabled");
  });
  it("ignores an upload in another environment", () => {
    fixture.uploads["environment-1:second"] = { status: "ready" };
    fixture.uploads["environment-2:second"] = { status: "uploading", progress: 0.5 };
    expect(submitButtonMarkup()).not.toContain("disabled");
  });
  it("waits for attachment preparation even when uploads are ready", () => {
    fixture.uploads["environment-1:second"] = { status: "ready" };
    fixture.preparations[key("first")] = 1;
    expect(submitButtonMarkup()).toContain("disabled");
  });
});

describe("answering an approval", () => {
  const answersKey = approvalAnswersKey(environmentId, ThreadId.make("thread-1"));
  function respond(requestId: ApprovalRequestId) {
    let answer: ReturnType<typeof useSelectedThreadRequests>["onRespondToApproval"] | null = null;
    function Probe() {
      answer = useSelectedThreadRequests().onRespondToApproval;
      return null;
    }
    renderToStaticMarkup(<Probe />);
    return answer!(requestId, "accept");
  }

  it("keeps a request answered elsewhere answered, without reporting a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fixture.respond = () =>
      Promise.resolve({
        _tag: "Failure",
        cause: Cause.fail(
          new OrchestrationDispatchCommandError({
            message: "This request has already been answered.",
            requestAlreadyAnswered: true,
          }),
        ),
      });
    const requestId = ApprovalRequestId.make("approval-elsewhere");
    await respond(requestId);
    expect(approvalAnswers.forThread(answersKey).get(requestId)).toBe("already-answered");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("frees and reports a request whose answer failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fixture.respond = () =>
      Promise.resolve({
        _tag: "Failure",
        cause: Cause.fail(new OrchestrationDispatchCommandError({ message: "Not running." })),
      });
    const requestId = ApprovalRequestId.make("approval-failed");
    await respond(requestId);
    expect(approvalAnswers.forThread(answersKey).has(requestId)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
