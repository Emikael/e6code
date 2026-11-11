import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Adds `projection_threads.pending_request_since`: when the oldest unresolved
 * approval or user-input request on the thread was asked. Backfills threads
 * that already wait on a request, using the same open-request rules as 024.
 * Guarded by PRAGMA so a rerun leaves an existing column alone.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (columns.some((column) => column.name === "pending_request_since")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN pending_request_since TEXT
  `;

  yield* sql`
    UPDATE projection_threads
    SET pending_request_since = (
      WITH latest_user_input_states AS (
        SELECT latest.request_id, latest.kind, latest.detail
        FROM (
          SELECT
            json_extract(activity.payload_json, '$.requestId') AS request_id,
            activity.kind,
            lower(COALESCE(json_extract(activity.payload_json, '$.detail'), '')) AS detail,
            ROW_NUMBER() OVER (
              PARTITION BY json_extract(activity.payload_json, '$.requestId')
              ORDER BY activity.created_at DESC, activity.activity_id DESC
            ) AS row_number
          FROM projection_thread_activities AS activity
          WHERE activity.thread_id = projection_threads.thread_id
            AND json_extract(activity.payload_json, '$.requestId') IS NOT NULL
            AND activity.kind IN (
              'user-input.requested',
              'user-input.resolved',
              'provider.user-input.respond.failed'
            )
        ) AS latest
        WHERE latest.row_number = 1
      ),
      open_user_input_requests AS (
        SELECT request_id
        FROM latest_user_input_states
        WHERE kind = 'user-input.requested'
          OR (
            kind = 'provider.user-input.respond.failed'
            AND detail NOT LIKE '%stale pending user-input request%'
            AND detail NOT LIKE '%unknown pending user-input request%'
            AND detail NOT LIKE '%unknown pending user input request%'
            AND detail NOT LIKE '%unknown pending codex user input request%'
          )
      ),
      request_times AS (
        SELECT MIN(requested.created_at) AS requested_at
        FROM projection_thread_activities AS requested
        WHERE requested.thread_id = projection_threads.thread_id
          AND requested.kind = 'user-input.requested'
          AND json_extract(requested.payload_json, '$.requestId') IN (
            SELECT request_id FROM open_user_input_requests
          )
        UNION ALL
        SELECT MIN(approval.created_at) AS requested_at
        FROM projection_pending_approvals AS approval
        WHERE approval.thread_id = projection_threads.thread_id
          AND approval.status = 'pending'
      )
      SELECT MIN(requested_at) FROM request_times
    )
    WHERE pending_approval_count > 0 OR pending_user_input_count > 0
  `;
});
