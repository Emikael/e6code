/**
 * ProjectionPendingApprovalRepository - Repository interface for pending approvals.
 *
 * Owns persistence operations for projected approval requests awaiting user
 * decisions.
 *
 * @module ProjectionPendingApprovalRepository
 */
import {
  ApprovalRequestId,
  IsoDateTime,
  ProjectionPendingApprovalDecision,
  ProjectionPendingApprovalStatus,
  ThreadId,
  TurnId,
} from "@e6tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionPendingApproval = Schema.Struct({
  requestId: ApprovalRequestId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  status: ProjectionPendingApprovalStatus,
  decision: ProjectionPendingApprovalDecision,
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
  /**
   * What the request's `approval.requested` activity named, stored with the
   * row so the shell summary reads it without scanning activities. Absent on
   * a write that does not know it; the stored value is then kept.
   */
  requestKind: Schema.optional(Schema.NullOr(Schema.String)),
  requestType: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ProjectionPendingApproval = typeof ProjectionPendingApproval.Type;

export const ListProjectionPendingApprovalsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionPendingApprovalsInput = typeof ListProjectionPendingApprovalsInput.Type;

export const GetProjectionPendingApprovalInput = Schema.Struct({
  requestId: ApprovalRequestId,
});
export type GetProjectionPendingApprovalInput = typeof GetProjectionPendingApprovalInput.Type;

/**
 * ProjectionPendingApprovalRepositoryShape - Service API for pending approvals.
 */
export interface ProjectionPendingApprovalRepositoryShape {
  /**
   * Insert or replace a projected pending approval row.
   *
   * Upserts by `requestId`.
   */
  readonly upsert: (
    row: ProjectionPendingApproval,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * List pending approvals for a thread.
   *
   * Returned in ascending creation order.
   */
  readonly listByThreadId: (
    input: ListProjectionPendingApprovalsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionPendingApproval>, ProjectionRepositoryError>;

  /**
   * Count pending approvals and find when the oldest was requested, without
   * loading resolved request history. `earliestCreatedAt` is null when none
   * is pending.
   */
  readonly summarizePendingByThreadId: (
    input: ListProjectionPendingApprovalsInput,
  ) => Effect.Effect<
    { readonly count: number; readonly earliestCreatedAt: string | null },
    ProjectionRepositoryError
  >;

  /**
   * What each pending approval asks, oldest first: the `requestKind` and
   * `requestType` its `approval.requested` activity carried, null when the
   * activity is gone or named neither.
   */
  readonly listPendingKindsByThreadId: (
    input: ListProjectionPendingApprovalsInput,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly requestKind: string | null; readonly requestType: string | null }>,
    ProjectionRepositoryError
  >;

  /**
   * Read a pending approval row by request id.
   */
  readonly getByRequestId: (
    input: GetProjectionPendingApprovalInput,
  ) => Effect.Effect<Option.Option<ProjectionPendingApproval>, ProjectionRepositoryError>;

  /**
   * Delete every pending approval row for a thread.
   */
  readonly deleteByThreadId: (
    input: ListProjectionPendingApprovalsInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionPendingApprovalRepository - Service tag for pending approval persistence.
 */
export class ProjectionPendingApprovalRepository extends Context.Service<
  ProjectionPendingApprovalRepository,
  ProjectionPendingApprovalRepositoryShape
>()("e6/persistence/Services/ProjectionPendingApprovals/ProjectionPendingApprovalRepository") {}
