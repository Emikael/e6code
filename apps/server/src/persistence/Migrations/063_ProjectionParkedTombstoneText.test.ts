import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@e6tools/shared/nodeSqliteClient";

it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "063_ProjectionParkedTombstoneText",
  (it) => {
    it.effect("clears the text of removed thoughts and keeps the rest", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 62 });
        yield* sql`
          INSERT INTO projection_parked_entries (
            entry_id, kind, text, project_id, thread_id, pinned_for, created_at, updated_at,
            removed_at
          ) VALUES
            ('kept', 'thought', 'Keep me', NULL, NULL, NULL,
             '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', NULL),
            ('gone', 'thought', 'Private text', NULL, NULL, NULL,
             '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')
        `;
        yield* runMigrations({});
        const rows = yield* sql<{ readonly id: string; readonly text: string }>`
          SELECT entry_id AS "id", text FROM projection_parked_entries ORDER BY entry_id
        `;
        assert.deepEqual(rows, [
          { id: "gone", text: "" },
          { id: "kept", text: "Keep me" },
        ]);
      }),
    );
  },
);
