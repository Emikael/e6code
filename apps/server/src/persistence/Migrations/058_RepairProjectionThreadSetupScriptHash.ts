import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Re-adds `projection_threads.setup_script_hash` where 054 never ran. Id 54
 * held other migrations in earlier builds (ThreadWorkspaces, then the reverted
 * "Split into subagents"), so a database that recorded one of those skips the
 * real 054 and every thread query fails with "no such column". Idempotent: a
 * database that already has the column is left as is.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!columns.some((column) => column.name === "setup_script_hash")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN setup_script_hash TEXT
    `;
  }
});
