import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Adds `projection_threads.pending_request_summary_json`: what the thread's
 * open requests ask (`ThreadPendingRequestSummary`), refreshed with the
 * pending counts. No backfill: a thread already blocked keeps the generic
 * wording until its next request event refreshes the summary. Guarded by
 * PRAGMA so a rerun leaves an existing column alone.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (columns.some((column) => column.name === "pending_request_summary_json")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN pending_request_summary_json TEXT
  `;
});
