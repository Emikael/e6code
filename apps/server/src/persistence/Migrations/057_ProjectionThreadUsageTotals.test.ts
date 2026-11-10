import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@e6tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("057_ProjectionThreadUsageTotals", (it) => {
  it.effect("backfills one usage total per thread from existing turn.usage rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 56 });
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        VALUES
          ('a1', 'thread-a', 't1', 'info', 'turn.usage', 'Usage',
            '{"totalTokens":1000,"costUsd":0.5,"costSource":"reported"}', 1,
            '2026-03-01T00:00:00.000Z'),
          ('a2', 'thread-a', 't2', 'info', 'turn.usage', 'Usage',
            '{"totalTokens":250,"costUsd":0.125,"costSource":"estimated"}', 2,
            '2026-03-01T00:00:01.000Z'),
          ('a3', 'thread-a', 't2', 'tool', 'tool.completed', 'Tool',
            '{"totalTokens":99999}', 3, '2026-03-01T00:00:02.000Z'),
          ('b1', 'thread-b', 't1', 'info', 'turn.usage', 'Usage',
            '{"totalTokens":40,"partial":true}', 1, '2026-03-01T00:00:00.000Z'),
          ('c1', 'thread-c', 't1', 'tool', 'tool.completed', 'Tool',
            '{}', 1, '2026-03-01T00:00:00.000Z')
      `;

      yield* runMigrations({ toMigrationInclusive: 57 });

      const rows = yield* sql`
        SELECT
          thread_id AS "threadId",
          turn_count AS "turnCount",
          total_tokens AS "totalTokens",
          cost_usd AS "costUsd",
          costed_turn_count AS "costedTurnCount",
          estimated_turn_count AS "estimatedTurnCount"
        FROM projection_thread_usage_totals
        ORDER BY thread_id
      `;
      assert.deepEqual(rows, [
        {
          threadId: "thread-a",
          turnCount: 2,
          totalTokens: 1250,
          costUsd: 0.625,
          costedTurnCount: 2,
          estimatedTurnCount: 1,
        },
        {
          threadId: "thread-b",
          turnCount: 1,
          totalTokens: 40,
          costUsd: null,
          costedTurnCount: 0,
          estimatedTurnCount: 0,
        },
      ]);
    }),
  );
});
