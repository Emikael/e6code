import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@e6tools/shared/nodeSqliteClient";

it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "059_ProjectionThreadsPendingRequestSince",
  (it) => {
    it.effect("backfills the oldest open approval or question for blocked threads", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 58 });

        for (const [threadId, approvals, inputs] of [
          ["thread-approval", 1, 0],
          ["thread-question", 0, 1],
          ["thread-idle", 0, 0],
        ] as const) {
          yield* sql`
            INSERT INTO projection_threads (
              thread_id, project_id, title, model_selection_json, runtime_mode,
              interaction_mode, branch, worktree_path, latest_turn_id, latest_user_message_at,
              pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
              created_at, updated_at, archived_at, deleted_at
            )
            VALUES (
              ${threadId}, 'project-1', 'Thread', '{}', 'full-access', 'default', NULL, NULL,
              NULL, NULL, ${approvals}, ${inputs}, 0,
              '2026-04-02T00:00:00.000Z', '2026-04-02T00:00:00.000Z', NULL, NULL
            )
          `;
        }
        yield* sql`
          INSERT INTO projection_pending_approvals (
            request_id, thread_id, turn_id, status, decision, created_at, resolved_at
          ) VALUES
            ('approval-old', 'thread-approval', NULL, 'resolved', 'accept',
             '2026-04-02T00:00:01.000Z', '2026-04-02T00:00:02.000Z'),
            ('approval-open', 'thread-approval', NULL, 'pending', NULL,
             '2026-04-02T00:00:03.000Z', NULL)
        `;
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
          ) VALUES
            ('a1', 'thread-question', NULL, 'info', 'user-input.requested', 'q',
             '{"requestId":"q-answered"}', '2026-04-02T00:00:01.000Z'),
            ('a2', 'thread-question', NULL, 'info', 'user-input.resolved', 'q',
             '{"requestId":"q-answered"}', '2026-04-02T00:00:02.000Z'),
            ('a3', 'thread-question', NULL, 'info', 'user-input.requested', 'q',
             '{"requestId":"q-open"}', '2026-04-02T00:00:05.000Z')
        `;

        yield* runMigrations({});

        const rows = yield* sql<{
          readonly threadId: string;
          readonly pendingRequestSince: string | null;
        }>`
          SELECT thread_id AS "threadId", pending_request_since AS "pendingRequestSince"
          FROM projection_threads
          ORDER BY thread_id
        `;
        assert.deepEqual(rows, [
          { threadId: "thread-approval", pendingRequestSince: "2026-04-02T00:00:03.000Z" },
          { threadId: "thread-idle", pendingRequestSince: null },
          { threadId: "thread-question", pendingRequestSince: "2026-04-02T00:00:05.000Z" },
        ]);
      }),
    );
  },
);
