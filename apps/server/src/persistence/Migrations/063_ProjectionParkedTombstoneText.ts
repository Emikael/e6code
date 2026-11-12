import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * A removed Parked entry keeps its row only as a tombstone, so it keeps no
 * text. Rows removed before this rule lose theirs here.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_parked_entries
    SET text = ''
    WHERE removed_at IS NOT NULL
  `;
});
