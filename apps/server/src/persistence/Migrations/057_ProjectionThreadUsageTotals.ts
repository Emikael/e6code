import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Thread shells carry a running usage total. Summing every `turn.usage` row on
// each shell snapshot grew with history, so the activity repository keeps one
// folded row per thread instead and this migration backfills it once.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_usage_totals (
      thread_id TEXT PRIMARY KEY,
      turn_count INTEGER NOT NULL,
      total_tokens NUMERIC,
      cost_usd NUMERIC,
      costed_turn_count INTEGER NOT NULL,
      estimated_turn_count INTEGER NOT NULL
    )
  `;

  yield* sql`
    INSERT OR REPLACE INTO projection_thread_usage_totals (
      thread_id,
      turn_count,
      total_tokens,
      cost_usd,
      costed_turn_count,
      estimated_turn_count
    )
    SELECT
      thread_id,
      COUNT(*),
      SUM(json_extract(payload_json, '$.totalTokens')),
      SUM(json_extract(payload_json, '$.costUsd')),
      COUNT(json_extract(payload_json, '$.costUsd')),
      COUNT(CASE WHEN json_extract(payload_json, '$.costSource') = 'estimated' THEN 1 END)
    FROM projection_thread_activities
    WHERE kind = 'turn.usage'
    GROUP BY thread_id
  `;
});
