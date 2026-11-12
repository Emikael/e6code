import {
  IsoDateTime,
  OrchestrationParkedEntry,
  ParkedEntryId,
  ParkedEntryKind,
  ParkedPinDate,
  ParkedText,
  ProjectId,
  ThreadId,
  type OrchestrationParkedState,
} from "@e6tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "./Errors.ts";

const ParkedEntryDbRow = Schema.Struct({
  id: ParkedEntryId,
  kind: ParkedEntryKind,
  text: ParkedText,
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  pinnedFor: Schema.NullOr(ParkedPinDate),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  removedAt: Schema.NullOr(IsoDateTime),
});

const RemoveParkedEntryInput = Schema.Struct({
  entryId: ParkedEntryId,
  removedAt: IsoDateTime,
});

/**
 * Rows of the `parked` aggregate's projection (migration 061). A removed
 * thought keeps its row as a tombstone; a removed note is deleted, since its
 * id follows from the thread and needs no remembering.
 */
export class ProjectionParkedEntryRepository extends Context.Service<
  ProjectionParkedEntryRepository,
  {
    readonly upsert: (
      entry: OrchestrationParkedEntry,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly remove: (
      input: typeof RemoveParkedEntryInput.Type,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly removeNoteForThread: (
      threadId: ThreadId,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly getState: () => Effect.Effect<OrchestrationParkedState, ProjectionRepositoryError>;
  }
>()("e6/persistence/ProjectionParkedEntries/ProjectionParkedEntryRepository") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: OrchestrationParkedEntry,
    execute: (entry) => sql`
      INSERT INTO projection_parked_entries (
        entry_id, kind, text, project_id, thread_id, pinned_for, created_at, updated_at, removed_at
      )
      VALUES (
        ${entry.id},
        ${entry.kind},
        ${entry.text},
        ${entry.projectId},
        ${entry.threadId},
        ${entry.pinnedFor},
        ${entry.createdAt},
        ${entry.updatedAt},
        NULL
      )
      ON CONFLICT (entry_id) DO UPDATE SET
        kind = excluded.kind,
        text = excluded.text,
        project_id = excluded.project_id,
        thread_id = excluded.thread_id,
        pinned_for = excluded.pinned_for,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        removed_at = NULL
    `,
  });

  const removeRow = (input: typeof RemoveParkedEntryInput.Type) =>
    Effect.all(
      [
        sql`
          UPDATE projection_parked_entries
          SET removed_at = ${input.removedAt}, updated_at = ${input.removedAt}
          WHERE entry_id = ${input.entryId} AND kind = 'thought'
        `,
        sql`
          DELETE FROM projection_parked_entries
          WHERE entry_id = ${input.entryId} AND kind = 'note'
        `,
      ],
      { discard: true },
    );

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ParkedEntryDbRow,
    execute: () => sql`
      SELECT
        entry_id AS "id",
        kind,
        text,
        project_id AS "projectId",
        thread_id AS "threadId",
        pinned_for AS "pinnedFor",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        removed_at AS "removedAt"
      FROM projection_parked_entries
      ORDER BY created_at DESC, entry_id DESC
    `,
  });

  return {
    upsert: (entry) =>
      upsertRow(entry).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionParkedEntryRepository.upsert:query")),
      ),
    remove: (input) =>
      removeRow(input).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionParkedEntryRepository.remove:query")),
      ),
    removeNoteForThread: (threadId) =>
      sql`
        DELETE FROM projection_parked_entries
        WHERE thread_id = ${threadId} AND kind = 'note'
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("ProjectionParkedEntryRepository.removeNoteForThread:query"),
        ),
      ),
    getState: () =>
      listRows(undefined).pipe(
        Effect.map((rows) => {
          const entries: OrchestrationParkedEntry[] = [];
          const removedEntryIds: ParkedEntryId[] = [];
          for (const { removedAt, ...entry } of rows) {
            if (removedAt === null) entries.push(entry);
            else removedEntryIds.push(entry.id);
          }
          return { entries, removedEntryIds };
        }),
        Effect.mapError(toPersistenceSqlError("ProjectionParkedEntryRepository.getState:query")),
      ),
  } satisfies ProjectionParkedEntryRepository["Service"];
});

export const layer = Layer.effect(ProjectionParkedEntryRepository, make);
