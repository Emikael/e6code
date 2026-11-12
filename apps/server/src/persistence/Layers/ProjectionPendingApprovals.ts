import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionPendingApprovalInput,
  ListProjectionPendingApprovalsInput,
  ProjectionPendingApproval,
  ProjectionPendingApprovalRepository,
  type ProjectionPendingApprovalRepositoryShape,
} from "../Services/ProjectionPendingApprovals.ts";

const makeProjectionPendingApprovalRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionPendingApprovalRow = SqlSchema.void({
    Request: ProjectionPendingApproval,
    execute: (row) =>
      sql`
        INSERT INTO projection_pending_approvals (
          request_id,
          thread_id,
          turn_id,
          status,
          decision,
          created_at,
          resolved_at
        )
        VALUES (
          ${row.requestId},
          ${row.threadId},
          ${row.turnId},
          ${row.status},
          ${row.decision},
          ${row.createdAt},
          ${row.resolvedAt}
        )
        ON CONFLICT (request_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          status = excluded.status,
          decision = excluded.decision,
          created_at = excluded.created_at,
          resolved_at = excluded.resolved_at
      `,
  });

  const listProjectionPendingApprovalRows = SqlSchema.findAll({
    Request: ListProjectionPendingApprovalsInput,
    Result: ProjectionPendingApproval,
    execute: ({ threadId }) =>
      sql`
        SELECT
          request_id AS "requestId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, request_id ASC
      `,
  });

  const summarizePendingApprovalRows = SqlSchema.findOne({
    Request: ListProjectionPendingApprovalsInput,
    Result: Schema.Struct({
      count: Schema.Number,
      earliestCreatedAt: Schema.NullOr(Schema.String),
    }),
    execute: ({ threadId }) => sql`
      SELECT COUNT(*) AS count, MIN(created_at) AS "earliestCreatedAt"
      FROM projection_pending_approvals
      WHERE thread_id = ${threadId} AND status = 'pending'
    `,
  });

  // One activity per request: the latest `approval.requested` that names it.
  const listPendingApprovalKindRows = SqlSchema.findAll({
    Request: ListProjectionPendingApprovalsInput,
    Result: Schema.Struct({
      requestKind: Schema.NullOr(Schema.String),
      requestType: Schema.NullOr(Schema.String),
    }),
    execute: ({ threadId }) => sql`
      SELECT
        json_extract(activity.payload_json, '$.requestKind') AS "requestKind",
        json_extract(activity.payload_json, '$.requestType') AS "requestType"
      FROM projection_pending_approvals AS pending
      LEFT JOIN projection_thread_activities AS activity
        ON activity.activity_id = (
          SELECT candidate.activity_id
          FROM projection_thread_activities AS candidate
          WHERE candidate.thread_id = pending.thread_id
            AND candidate.kind = 'approval.requested'
            AND json_extract(candidate.payload_json, '$.requestId') = pending.request_id
          ORDER BY candidate.created_at DESC, candidate.activity_id DESC
          LIMIT 1
        )
      WHERE pending.thread_id = ${threadId} AND pending.status = 'pending'
      ORDER BY pending.created_at ASC, pending.request_id ASC
    `,
  });

  const getProjectionPendingApprovalRow = SqlSchema.findOneOption({
    Request: GetProjectionPendingApprovalInput,
    Result: ProjectionPendingApproval,
    execute: ({ requestId }) =>
      sql`
        SELECT
          request_id AS "requestId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE request_id = ${requestId}
      `,
  });

  const deleteProjectionPendingApprovalRowsByThread = SqlSchema.void({
    Request: ListProjectionPendingApprovalsInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_pending_approvals
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionPendingApprovalRepositoryShape["upsert"] = (row) =>
    upsertProjectionPendingApprovalRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionPendingApprovalRepository.upsert:query")),
    );

  const listByThreadId: ProjectionPendingApprovalRepositoryShape["listByThreadId"] = (input) =>
    listProjectionPendingApprovalRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.listByThreadId:query"),
      ),
    );

  const summarizePendingByThreadId: ProjectionPendingApprovalRepositoryShape["summarizePendingByThreadId"] =
    (input) =>
      summarizePendingApprovalRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionPendingApprovalRepository.summarizePendingByThreadId:query",
          ),
        ),
      );

  const listPendingKindsByThreadId: ProjectionPendingApprovalRepositoryShape["listPendingKindsByThreadId"] =
    (input) =>
      listPendingApprovalKindRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionPendingApprovalRepository.listPendingKindsByThreadId:query",
          ),
        ),
      );

  const getByRequestId: ProjectionPendingApprovalRepositoryShape["getByRequestId"] = (input) =>
    getProjectionPendingApprovalRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.getByRequestId:query"),
      ),
    );

  const deleteByThreadId: ProjectionPendingApprovalRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionPendingApprovalRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listByThreadId,
    summarizePendingByThreadId,
    listPendingKindsByThreadId,
    getByRequestId,
    deleteByThreadId,
  } satisfies ProjectionPendingApprovalRepositoryShape;
});

export const ProjectionPendingApprovalRepositoryLive = Layer.effect(
  ProjectionPendingApprovalRepository,
  makeProjectionPendingApprovalRepository,
);
