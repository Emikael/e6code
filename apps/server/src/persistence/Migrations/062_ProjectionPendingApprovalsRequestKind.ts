import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Adds `projection_pending_approvals.request_kind` and `request_type`: what
 * the request's `approval.requested` activity named, stored when the row is
 * written so the shell summary no longer scans the thread's activities.
 * Backfills only rows still pending, which are few. Guarded by PRAGMA so a
 * rerun leaves existing columns alone.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_pending_approvals)
  `;
  if (columns.some((column) => column.name === "request_kind")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_pending_approvals
    ADD COLUMN request_kind TEXT
  `;
  yield* sql`
    ALTER TABLE projection_pending_approvals
    ADD COLUMN request_type TEXT
  `;
  yield* sql`
    UPDATE projection_pending_approvals
    SET
      request_kind = (
        SELECT json_extract(activity.payload_json, '$.requestKind')
        FROM projection_thread_activities AS activity
        WHERE activity.thread_id = projection_pending_approvals.thread_id
          AND activity.kind = 'approval.requested'
          AND json_extract(activity.payload_json, '$.requestId') = projection_pending_approvals.request_id
        ORDER BY activity.created_at DESC, activity.activity_id DESC
        LIMIT 1
      ),
      request_type = (
        SELECT json_extract(activity.payload_json, '$.requestType')
        FROM projection_thread_activities AS activity
        WHERE activity.thread_id = projection_pending_approvals.thread_id
          AND activity.kind = 'approval.requested'
          AND json_extract(activity.payload_json, '$.requestId') = projection_pending_approvals.request_id
        ORDER BY activity.created_at DESC, activity.activity_id DESC
        LIMIT 1
      )
    WHERE status = 'pending'
  `;
});
