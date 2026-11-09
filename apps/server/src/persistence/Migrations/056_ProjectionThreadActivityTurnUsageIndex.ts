import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Thread shells carry a running cost total summed from `turn.usage` rows on
// every shell refetch. A partial index keeps that sum proportional to the
// thread's turns rather than to all of its activities.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_turn_usage
    ON projection_thread_activities(thread_id)
    WHERE kind = 'turn.usage'
  `;
});
