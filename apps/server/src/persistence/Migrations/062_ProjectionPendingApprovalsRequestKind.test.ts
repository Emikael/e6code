import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@e6tools/shared/nodeSqliteClient";

it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "062_ProjectionPendingApprovalsRequestKind",
  (it) => {
    it.effect("backfills the kind of approvals still pending from their latest request", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 61 });

        yield* sql`
          INSERT INTO projection_pending_approvals (
            request_id, thread_id, turn_id, status, decision, created_at, resolved_at
          ) VALUES
            ('open-command', 'thread-1', NULL, 'pending', NULL, '2026-04-02T00:00:01.000Z', NULL),
            ('open-legacy', 'thread-1', NULL, 'pending', NULL, '2026-04-02T00:00:02.000Z', NULL),
            ('closed', 'thread-1', NULL, 'resolved', 'accept',
             '2026-04-02T00:00:03.000Z', '2026-04-02T00:00:04.000Z')
        `;
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
          ) VALUES
            ('a1', 'thread-1', NULL, 'approval', 'approval.requested', 'r',
             '{"requestId":"open-command","requestKind":"file-read"}', '2026-04-02T00:00:01.000Z'),
            ('a2', 'thread-1', NULL, 'approval', 'approval.requested', 'r',
             '{"requestId":"open-command","requestKind":"command","requestType":"command_execution_approval"}',
             '2026-04-02T00:00:05.000Z'),
            ('a3', 'thread-1', NULL, 'approval', 'approval.requested', 'r',
             '{"requestId":"open-legacy","requestType":"apply_patch_approval"}',
             '2026-04-02T00:00:02.000Z'),
            ('a4', 'thread-1', NULL, 'approval', 'approval.requested', 'r',
             '{"requestId":"closed","requestKind":"command"}', '2026-04-02T00:00:03.000Z')
        `;

        yield* runMigrations({});

        const rows = yield* sql<{
          readonly requestId: string;
          readonly requestKind: string | null;
          readonly requestType: string | null;
        }>`
          SELECT request_id AS "requestId", request_kind AS "requestKind",
            request_type AS "requestType"
          FROM projection_pending_approvals
          ORDER BY request_id
        `;
        assert.deepEqual(rows, [
          { requestId: "closed", requestKind: null, requestType: null },
          {
            requestId: "open-command",
            requestKind: "command",
            requestType: "command_execution_approval",
          },
          { requestId: "open-legacy", requestKind: null, requestType: "apply_patch_approval" },
        ]);
      }),
    );
  },
);
