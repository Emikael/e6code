/**
 * Parked thoughts and notes to self (F7, phase 20). An environment keeps one
 * Parked list, so every client connected to it (web, desktop, mobile, any
 * origin) sees the same thoughts and the same note on a thread. Drafts stashed
 * from a composer stay in the client that stashed them and never come here.
 *
 * The list is the `parked` orchestration aggregate: commands and events live
 * with the rest in `orchestration.ts`; this file holds the entry and the rules
 * clients and the server share.
 */
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ParkedEntryId,
  ParkedListId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** The only id the `parked` aggregate has: an environment has one list. */
export const PARKED_LIST_ID = ParkedListId.make("parked");

/** Past either cap a new entry is refused; nothing is evicted (decision 10). */
export const PARKED_THOUGHTS_MAX = 200;
export const PARKED_NOTES_MAX = 200;
/** One import carries at most every entry both caps allow. */
export const PARKED_IMPORT_MAX = PARKED_THOUGHTS_MAX + PARKED_NOTES_MAX;
const PARKED_TEXT_MAX_CHARS = 8_000;

export const ParkedEntryKind = Schema.Literals(["thought", "note"]);
export type ParkedEntryKind = typeof ParkedEntryKind.Type;

export const ParkedText = TrimmedNonEmptyString.check(Schema.isMaxLength(PARKED_TEXT_MAX_CHARS));

/** A local calendar day ("2026-11-13") on which a thought leads the start screen. */
export const ParkedPinDate = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

export const OrchestrationParkedEntry = Schema.Struct({
  id: ParkedEntryId,
  kind: ParkedEntryKind,
  text: ParkedText,
  /** The project a thought was parked in, for "e6code · 14:09". */
  projectId: Schema.NullOr(ProjectId),
  /** A note's thread. Null for thoughts. */
  threadId: Schema.NullOr(ThreadId),
  pinnedFor: Schema.NullOr(ParkedPinDate),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationParkedEntry = typeof OrchestrationParkedEntry.Type;

/**
 * An entry a client already holds, sent once so the server keeps it. The id
 * is the client's own, so sending the same entry twice keeps one copy.
 */
export const ParkedImportEntry = Schema.Struct({
  id: ParkedEntryId,
  kind: ParkedEntryKind,
  text: ParkedText,
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  pinnedFor: Schema.NullOr(ParkedPinDate),
  createdAt: IsoDateTime,
});
export type ParkedImportEntry = typeof ParkedImportEntry.Type;

/**
 * The read model's Parked list. `removedEntryIds` remembers thoughts deleted
 * here, so a client still holding an old copy cannot bring one back by
 * importing it again.
 */
export const OrchestrationParkedState = Schema.Struct({
  entries: Schema.Array(OrchestrationParkedEntry),
  removedEntryIds: Schema.Array(ParkedEntryId),
});
export type OrchestrationParkedState = typeof OrchestrationParkedState.Type;

export const EMPTY_PARKED_STATE: OrchestrationParkedState = { entries: [], removedEntryIds: [] };

/** A thread has at most one note, so its id follows from the thread. */
export function parkedNoteId(threadId: ThreadId): ParkedEntryId {
  return ParkedEntryId.make(`note:${threadId}`);
}

export const OrchestrationSubscribeParkedInput = Schema.Struct({});
export type OrchestrationSubscribeParkedInput = typeof OrchestrationSubscribeParkedInput.Type;

/**
 * The Parked stream: the whole list when a subscription starts, then one item
 * per change. A reconnect starts again from a fresh snapshot.
 */
export const OrchestrationParkedStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    entries: Schema.Array(OrchestrationParkedEntry),
    removedEntryIds: Schema.Array(ParkedEntryId),
  }),
  Schema.Struct({
    kind: Schema.Literal("upserted"),
    entry: OrchestrationParkedEntry,
  }),
  Schema.Struct({
    kind: Schema.Literal("removed"),
    entryId: ParkedEntryId,
  }),
]);
export type OrchestrationParkedStreamItem = typeof OrchestrationParkedStreamItem.Type;

/**
 * Folds stream items into the list a client shows. Newest first, the order the
 * Parked list uses.
 */
export function reduceParkedStream(
  state: OrchestrationParkedState,
  item: OrchestrationParkedStreamItem,
): OrchestrationParkedState {
  switch (item.kind) {
    case "snapshot":
      return { entries: sortParkedEntries(item.entries), removedEntryIds: item.removedEntryIds };
    case "upserted":
      return {
        entries: sortParkedEntries([
          ...state.entries.filter((entry) => entry.id !== item.entry.id),
          item.entry,
        ]),
        removedEntryIds: state.removedEntryIds.filter((id) => id !== item.entry.id),
      };
    case "removed":
      return {
        entries: state.entries.filter((entry) => entry.id !== item.entryId),
        removedEntryIds: state.removedEntryIds.includes(item.entryId)
          ? state.removedEntryIds
          : [...state.removedEntryIds, item.entryId],
      };
  }
}

function sortParkedEntries(
  entries: ReadonlyArray<OrchestrationParkedEntry>,
): ReadonlyArray<OrchestrationParkedEntry> {
  return [...entries].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}
