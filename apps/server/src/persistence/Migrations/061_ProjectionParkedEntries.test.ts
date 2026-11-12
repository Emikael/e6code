import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@e6tools/shared/nodeSqliteClient";

const parkedCursor = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly sequence: number }>`
    SELECT last_applied_sequence AS "sequence"
    FROM projection_state
    WHERE projector = 'projection.parked'
  `;
  return rows.map((row) => row.sequence);
});

it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "061_ProjectionParkedEntries on a fresh database",
  (it) => {
    it.effect("starts the Parked projector at the beginning", () =>
      Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: 61 });
        assert.deepEqual(yield* parkedCursor, [0]);
      }),
    );
  },
);

it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "061_ProjectionParkedEntries on a database with history",
  (it) => {
    it.effect("starts the Parked projector after the events already stored", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 60 });
        // History from before the aggregate existed is not replayed into it.
        for (const version of [1, 2, 3]) {
          yield* sql`
            INSERT INTO orchestration_events (
              event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
              actor_kind, payload_json, metadata_json
            ) VALUES (
              ${`event-${version}`}, 'thread', 'thread-1', ${version}, 'thread.meta-updated',
              '2026-11-01T00:00:00.000Z', 'client', '{}', '{}'
            )
          `;
        }
        yield* runMigrations({ toMigrationInclusive: 61 });
        assert.deepEqual(yield* parkedCursor, [3]);
      }),
    );
  },
);
