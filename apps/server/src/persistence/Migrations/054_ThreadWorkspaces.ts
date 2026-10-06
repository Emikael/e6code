import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN workspace_generation INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN workspace_operation_json TEXT`;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN workspace_provenance_json TEXT`;
  yield* sql`ALTER TABLE projection_turns ADD COLUMN workspace_provenance_json TEXT`;
});
