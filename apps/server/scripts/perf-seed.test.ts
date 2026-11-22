import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ThreadId,
} from "@e6tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../src/orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSqlitePersistenceLive } from "../src/persistence/Layers/Sqlite.ts";
import { assertSeedableBaseDir, perfSeedRuntimeLayer, seedPerfHome } from "./perf-seed.ts";

const cursor = ProviderDriverKind.make("cursor");

const tempDirectory = Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
  fileSystem.makeTempDirectoryScoped({ prefix: "e6-perf-seed-test-" }),
);

describe("perf-seed", () => {
  it.live(
    "seeds a home whose projections, cursors and command read model a fresh engine opens",
    () =>
      Effect.gen(function* () {
        const baseDir = yield* tempDirectory;
        const workspace = yield* tempDirectory;
        const summary = yield* seedPerfHome({
          baseDir,
          workspace,
          liveHomes: [],
          threads: 2,
          longThreadTurns: 3,
          turnsPerThread: 2,
          providers: [cursor],
          longThreadShape: "turns",
        });
        expect(summary).toMatchObject({ threads: 2, longThreadTurns: 3 });

        // The seed leaves every projection cursor on its last event.
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const [events] = yield* sql<{
            readonly maxSequence: number;
          }>`SELECT MAX(sequence) AS maxSequence FROM orchestration_events`;
          expect(events?.maxSequence).toBe(summary.maxSequence);
          const cursors = yield* sql<{
            readonly projector: string;
            readonly lastAppliedSequence: number;
          }>`SELECT projector, last_applied_sequence AS lastAppliedSequence FROM projection_state`;
          expect(cursors.length).toBeGreaterThan(1);
          for (const cursor of cursors) {
            expect(cursor.lastAppliedSequence, cursor.projector).toBe(summary.maxSequence);
          }
        }).pipe(Effect.provide(makeSqlitePersistenceLive(summary.dbPath)));

        // A second runtime over the same file sees exactly what a booting server would.
        yield* Effect.gen(function* () {
          const query = yield* ProjectionSnapshotQuery;
          const long = Option.getOrThrow(
            yield* query.getThreadDetailById(ThreadId.make(summary.longThreadId!)),
          );
          const byRole = (role: string) => long.messages.filter((message) => message.role === role);
          expect(byRole("user")).toHaveLength(3);
          expect(byRole("assistant")).toHaveLength(3);
          expect(byRole("assistant").every((message) => !message.streaming)).toBe(true);
          expect(byRole("assistant").every((message) => message.text.length > 100)).toBe(true);
          expect(byRole("reasoning")).toHaveLength(3);
          const turnIds = new Set(byRole("assistant").map((message) => message.turnId));
          expect(turnIds.size).toBe(3);
          for (const turnId of turnIds) {
            expect(long.activities.filter((activity) => activity.turnId === turnId)).toHaveLength(
              10,
            );
          }
          expect(long.latestTurn).toMatchObject({ state: "completed" });
          expect(long.session).toMatchObject({ status: "stopped", activeTurnId: null });

          const snapshot = yield* query.getSnapshot();
          expect(snapshot.threads).toHaveLength(2);
          for (const thread of snapshot.threads) {
            expect(thread.session).toMatchObject({ status: "stopped", activeTurnId: null });
            expect(thread.latestTurn?.state).toBe("completed");
          }

          // The engine loads its command read model at boot; it must know the project.
          const engine = yield* OrchestrationEngineService;
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make("after-seed-thread-create"),
            threadId: ThreadId.make("after-seed-thread"),
            projectId: summary.projectId,
            title: "After seed",
            modelSelection: { instanceId: defaultInstanceIdForDriver(cursor), model: "auto" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: DateTime.formatIso(yield* DateTime.now),
          });
        }).pipe(Effect.provide(perfSeedRuntimeLayer({ baseDir: summary.baseDir, cwd: workspace })));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a live home, a directory inside it, and a home that already has data", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const live = yield* tempDirectory;
      for (const baseDir of [live, path.join(live, "nested", "home")]) {
        const error = yield* Effect.flip(assertSeedableBaseDir({ baseDir, liveHomes: [live] }));
        expect(error._tag).toBe("PerfSeedUnsafeHomeError");
      }

      const used = yield* tempDirectory;
      yield* fileSystem.makeDirectory(path.join(used, "userdata"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(used, "userdata", "state.sqlite"), "");
      const error = yield* Effect.flip(assertSeedableBaseDir({ baseDir: used, liveHomes: [live] }));
      expect(error.message).toContain("state.sqlite");

      const fresh = yield* tempDirectory;
      const ok = yield* assertSeedableBaseDir({ baseDir: fresh, liveHomes: [live] });
      expect(ok.paths.dbPath).toBe(path.join(ok.baseDir, "userdata", "state.sqlite"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
