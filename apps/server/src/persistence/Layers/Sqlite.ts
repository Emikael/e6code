import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@e6tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";
import { PerformanceMetrics } from "../../observability/PerformanceMetrics.ts";

// The server provides PerformanceMetrics; the CLI and scripts do not, and run unobserved.
const statementObserver = Effect.serviceOption(PerformanceMetrics).pipe(
  Effect.map((metrics) => Option.getOrUndefined(metrics)?.sqliteObserver),
);

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // CLI and server write from separate processes; wait rather than fail with SQLITE_BUSY.
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* runMigrations();
  }),
);

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    setup,
    NodeSqliteClient.layer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "e6-server",
      },
      statementObserver: yield* statementObserver,
    }),
  );
}, Layer.unwrap);

export const SqlitePersistenceMemory = Layer.unwrap(
  Effect.map(statementObserver, (observer) =>
    Layer.provideMerge(
      setup,
      NodeSqliteClient.layer({ filename: ":memory:", statementObserver: observer }),
    ),
  ),
);

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    return makeSqlitePersistenceLive(dbPath);
  }),
);
