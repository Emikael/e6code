import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The environment's Parked list (`parked` aggregate): one row per parked
 * thought or note to self. A removed thought keeps its row with `removed_at`
 * set, so an old copy imported again is recognised and not brought back.
 *
 * No event before this migration belongs to the aggregate, so the projector's
 * cursor starts at the current end of the event log rather than replaying the
 * whole history on first start.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_parked_entries (
      entry_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      project_id TEXT,
      thread_id TEXT,
      pinned_for TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      removed_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_parked_entries_thread
    ON projection_parked_entries(thread_id)
  `;

  yield* sql`
    INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
    SELECT
      'projection.parked',
      COALESCE(MAX(sequence), 0),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM orchestration_events
    WHERE NOT EXISTS (
      SELECT 1 FROM projection_state WHERE projector = 'projection.parked'
    )
  `;
});
