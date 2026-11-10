import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@e6tools/shared/nodeSqliteClient";

const hasSetupScriptHash = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  return columns.some((column) => column.name === "setup_script_hash");
});

it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "058_RepairProjectionThreadSetupScriptHash",
  (it) => {
    it.effect("adds the column when an older migration already holds id 54", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 53 });
        // An earlier build recorded a different migration under id 54.
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (54, 'ProjectionThreadMessageSplitIntoSubagents')
        `;
        yield* runMigrations({ toMigrationInclusive: 57 });
        assert.isFalse(yield* hasSetupScriptHash);

        yield* runMigrations({});

        assert.isTrue(yield* hasSetupScriptHash);
        yield* sql`SELECT setup_script_hash FROM projection_threads LIMIT 1`;
      }),
    );
  },
);

it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "058_RepairProjectionThreadSetupScriptHash on a healthy database",
  (it) => {
    it.effect("leaves an existing column alone", () =>
      Effect.gen(function* () {
        yield* runMigrations({});
        assert.isTrue(yield* hasSetupScriptHash);
      }),
    );
  },
);
