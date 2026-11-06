import {
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
import { projectEvent } from "./projector.ts";

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

const command = (target: ThreadId) => ({
  type: "thread.subagent.stop" as const,
  commandId: CommandId.make("stop-subagent-1"),
  threadId: target,
  subagentId: "task-7",
  createdAt: NOW,
});

it.layer(NodeServices.layer)("subagent stop decider", (it) => {
  it.effect("records a stop request for one subagent without touching the turn", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({ command: command(threadId), readModel });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.subagent-stop-requested"]);
      expect(events[0]?.payload).toEqual({ threadId, subagentId: "task-7", createdAt: NOW });
      const projected = yield* projectEvent(readModel, { ...events[0]!, sequence: 1 });
      expect(projected.threads[0]?.latestTurn).toBeNull();
      expect(projected.threads[0]?.session).toBeNull();
    }),
  );

  it.effect("rejects a stop for a thread that does not exist", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: command(ThreadId.make("missing")),
        readModel,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
