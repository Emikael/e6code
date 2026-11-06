import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@e6tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const createdAt = "2026-08-24T10:00:00.000Z";
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-split");
const messageId = MessageId.make("message-split");

const readModelWithThread = Effect.gen(function* () {
  const withProject = yield* projectEvent(createEmptyReadModel(createdAt), {
    sequence: 1,
    eventId: EventId.make("event-project-created"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: createdAt,
    commandId: CommandId.make("command-project-created"),
    causationEventId: null,
    correlationId: CommandId.make("command-project-created"),
    metadata: {},
    payload: {
      projectId,
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: null,
      scripts: [],
      createdAt,
      updatedAt: createdAt,
    },
  });
  return yield* projectEvent(withProject, {
    sequence: 2,
    eventId: EventId.make("event-thread-created"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.created",
    occurredAt: createdAt,
    commandId: CommandId.make("command-thread-created"),
    causationEventId: null,
    correlationId: CommandId.make("command-thread-created"),
    metadata: {},
    payload: {
      threadId,
      projectId,
      title: "Bootstrap thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
      updatedAt: createdAt,
    },
  });
});

const appendCommand = {
  type: "thread.message.user.append" as const,
  commandId: CommandId.make("command-append"),
  threadId,
  message: { messageId, text: "Build it", attachments: [] },
  createdAt,
};

const turnStartCommand = {
  type: "thread.turn.start" as const,
  commandId: CommandId.make("command-turn-start"),
  threadId,
  message: { messageId, role: "user" as const, text: "Build it", attachments: [] },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  createdAt,
};

const eventsOf = <T>(planned: T | ReadonlyArray<T>): ReadonlyArray<T> =>
  Array.isArray(planned) ? planned : [planned as T];

it.layer(NodeServices.layer)("thread.turn.start splitIntoSubagents", (it) => {
  it.effect("asks for the split on the turn request, not on the stored message", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithThread;
      const events = eventsOf(
        yield* decideOrchestrationCommand({
          command: { ...turnStartCommand, splitIntoSubagents: true },
          readModel,
        }),
      );
      expect(events.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      // The stored message keeps the text exactly as typed and is only marked
      // once the reactor records that the split reached the provider.
      expect(events[0]?.payload).toMatchObject({ text: "Build it" });
      expect(events[0]?.payload).not.toHaveProperty("splitIntoSubagents");
      expect(events[1]?.payload).toMatchObject({ messageId, splitIntoSubagents: true });
    }),
  );

  it.effect("leaves the flag off when the switch was not used", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithThread;
      const events = eventsOf(
        yield* decideOrchestrationCommand({ command: turnStartCommand, readModel }),
      );
      for (const event of events) {
        expect(event.payload).not.toHaveProperty("splitIntoSubagents");
      }
    }),
  );

  it.effect("carries the request after a worktree bootstrap append", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelWithThread;
      const planned = yield* decideOrchestrationCommand({ command: appendCommand, readModel });
      const appended = Array.isArray(planned) ? planned[0]! : planned;
      const withMessage = yield* projectEvent(readModel, { ...appended, sequence: 3 });

      const events = eventsOf(
        yield* decideOrchestrationCommand({
          command: { ...turnStartCommand, splitIntoSubagents: true },
          readModel: withMessage,
        }),
      );
      expect(events.map((event) => event.type)).toEqual(["thread.turn-start-requested"]);
      expect(events[0]?.payload).toMatchObject({ splitIntoSubagents: true });
    }),
  );
});
