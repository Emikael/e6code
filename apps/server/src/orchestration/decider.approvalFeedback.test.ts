import {
  ApprovalRequestId,
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@e6tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("thread-1");

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: threadId,
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
      runtimeMode: "full-access",
      interactionMode: "default",
      pullRequests: [],
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      pinnedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: NOW,
};

const respond = (decision: "decline" | "accept", feedback?: string) => ({
  type: "thread.approval.respond" as const,
  commandId: CommandId.make(`respond-${decision}`),
  threadId,
  requestId: ApprovalRequestId.make("approval-1"),
  decision,
  ...(feedback !== undefined ? { feedback } : {}),
  createdAt: NOW,
});

it.layer(NodeServices.layer)("approval respond decider", (it) => {
  it.effect("keeps decline instructions on the response event", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: respond("decline", "Use the staging database"),
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.approval-response-requested"]);
      expect(events[0]?.payload).toEqual({
        threadId,
        requestId: "approval-1",
        decision: "decline",
        feedback: "Use the staging database",
        createdAt: NOW,
      });
    }),
  );

  it.effect("drops instructions sent with a decision that runs the tool", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: respond("accept", "Use the staging database"),
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.payload).not.toHaveProperty("feedback");
    }),
  );
});
