import {
  CheckpointRef,
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationReadModel,
} from "@e6tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-10-06T00:00:00.000Z";
const THREAD = ThreadId.make("thread-a");
const TURN = TurnId.make("turn-a");
function model(overrides: Partial<OrchestrationThread> = {}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    updatedAt: NOW,
    threads: [
      {
        id: THREAD,
        projectId: ProjectId.make("project"),
        title: "A",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        ...overrides,
      },
    ],
  };
}

it.layer(NodeServices.layer)("workspace safety", (it) => {
  it.effect("rejects legacy workspace metadata changes while a turn is running", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: model({
            session: {
              threadId: THREAD,
              status: "running",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: TURN,
              lastError: null,
              updatedAt: NOW,
            },
          }),
          command: {
            type: "thread.meta.update",
            commandId: CommandId.make("move"),
            threadId: THREAD,
            branch: "feature",
            worktreePath: "/other",
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
  it.effect("rejects a legacy file checkpoint after rebinding before restoring files", () =>
    Effect.gen(function* () {
      const readModel = model({
        checkpoints: [
          {
            turnId: TURN,
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("refs/e6/checkpoints/old"),
            status: "ready",
            files: [],
            assistantMessageId: null,
            completedAt: NOW,
          },
        ],
      });
      Object.assign(readModel.threads[0]!, { workspaceGeneration: 1 });
      const exit = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.checkpoint.revert",
            commandId: CommandId.make("revert"),
            threadId: THREAD,
            turnCount: 1,
            createdAt: NOW,
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
