// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CommandId,
  ParkedEntryId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  parkedNoteId,
} from "@e6tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect, it } from "@effect/vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import * as ThreadAgentState from "../ThreadAgentState.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const AT = "2026-11-12T10:00:00.000Z";
const projectId = ProjectId.make("parked-project");
const threadId = ThreadId.make("parked-thread");

function systemLayer(databasePath: string) {
  return Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(ThreadAgentState.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(makeSqlitePersistenceLive(databasePath)),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "e6-orchestration-parked-test-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

const importOnce = (commandId: string) => ({
  type: "parked.import" as const,
  commandId: CommandId.make(commandId),
  createdAt: AT,
  entries: [
    {
      id: ParkedEntryId.make("thought-a"),
      kind: "thought" as const,
      text: "Try view transitions for the sidebar",
      projectId,
      threadId: null,
      pinnedFor: "2026-11-13",
      createdAt: AT,
    },
    {
      id: ParkedEntryId.make("local-note"),
      kind: "note" as const,
      text: "Check dark mode on Android after this.",
      projectId: null,
      threadId,
      pinnedFor: null,
      createdAt: AT,
    },
  ],
});

it.effect(
  "keeps the Parked list and its tombstones across restarts, ignores a repeated upload and drops a deleted thread's note",
  () =>
    Effect.gen(function* () {
      // The uploads below were written before the server's clock reads now.
      yield* TestClock.setTime(Date.parse("2026-11-12T12:00:00.000Z"));
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-parked-")),
      );
      const databasePath = NodePath.join(directory, "state.sqlite");

      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("project"),
          projectId,
          title: "Parked",
          workspaceRoot: "/tmp/parked",
          createdAt: AT,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("thread"),
          threadId,
          projectId,
          title: "Parked",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: AT,
        });
        yield* engine.dispatch(importOnce("import-1"));
        yield* engine.dispatch({
          type: "parked.entry.remove",
          commandId: CommandId.make("remove-a"),
          entryId: ParkedEntryId.make("thought-a"),
        });
      }).pipe(Effect.provide(systemLayer(databasePath)));

      // A restart rebuilds the command read model from the projection, so the
      // removal is still remembered when a second browser uploads the same list.
      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        yield* engine.dispatch(importOnce("import-2"));
        const afterRestart = yield* query.getParkedState();
        expect(afterRestart.entries).toEqual([
          expect.objectContaining({
            id: parkedNoteId(threadId),
            kind: "note",
            text: "Check dark mode on Android after this.",
          }),
        ]);
        expect(afterRestart.removedEntryIds).toEqual(["thought-a"]);

        // A cleared note leaves a tombstone that survives the next restart.
        yield* engine.dispatch({
          type: "parked.note.set",
          commandId: CommandId.make("clear-note"),
          threadId,
          text: "",
          baseUpdatedAt: null,
          baseText: "Check dark mode on Android after this.",
          createdAt: AT,
        });
      }).pipe(Effect.provide(systemLayer(databasePath)));

      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        // The same old upload again: neither the thought nor the note comes back.
        yield* engine.dispatch(importOnce("import-3"));
        const state = yield* query.getParkedState();
        expect(state.entries).toEqual([]);
        expect(state.removedNotes).toEqual([
          expect.objectContaining({ id: parkedNoteId(threadId) }),
        ]);
        // Removed entries keep no text on the server.
        const sql = yield* SqlClient.SqlClient;
        const texts = yield* sql<{ readonly text: string }>`
          SELECT text FROM projection_parked_entries WHERE removed_at IS NOT NULL
        `;
        expect(texts.map((row) => row.text)).toEqual(["", ""]);

        const error = yield* Effect.flip(
          engine.dispatch({
            type: "parked.thought.update",
            commandId: CommandId.make("update-a"),
            entryId: ParkedEntryId.make("thought-a"),
            text: "Gone",
            pinnedFor: null,
          }),
        );
        expect(String(error)).toContain("is not parked");

        yield* engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("delete-thread"),
          threadId,
        });
        expect((yield* query.getParkedState()).entries).toEqual([]);
      }).pipe(Effect.provide(systemLayer(databasePath)));

      yield* Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true }));
    }),
);
