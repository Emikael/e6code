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
/**
 * The longest thought or note a client may send. A parked thought is a line
 * or two, and a note to self a few lines; 1,000 characters leaves room for a
 * pasted error or link while keeping a full list (400 entries) under about
 * 400KB, because the whole list travels on every subscribe and sits in each
 * browser's storage.
 */
export const PARKED_TEXT_MAX_CHARS = 1_000;
/**
 * A note joined from two devices' edits may grow to this. Past it the stale
 * edit is refused, and the client keeps its text.
 */
export const PARKED_NOTE_JOINED_MAX_CHARS = 2_000;
/** What builds before the 1,000 cap accepted; entries already stored keep reading. */
const PARKED_STORED_TEXT_MAX_CHARS = 8_000;
/**
 * How long a removed entry's tombstone is kept. Tombstones stop a stale copy
 * from bringing a removed entry back; past this age a copy a client says it
 * already sent once (`sentAt`) is skipped instead, so a device that was away
 * longer still cannot bring one back, and keeps its copy rather than losing it.
 */
export const PARKED_TOMBSTONE_MAX_AGE_DAYS = 90;
export const PARKED_TOMBSTONE_MAX_AGE_MS = PARKED_TOMBSTONE_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;

export const ParkedEntryKind = Schema.Literals(["thought", "note"]);
export type ParkedEntryKind = typeof ParkedEntryKind.Type;

/** Text a client sends. */
export const ParkedText = TrimmedNonEmptyString.check(Schema.isMaxLength(PARKED_TEXT_MAX_CHARS));
/** Text an entry holds: what clients send, a joined note, or an entry stored before the lower cap. */
export const ParkedStoredText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PARKED_STORED_TEXT_MAX_CHARS),
);

/** A local calendar day ("2026-11-13") on which a thought leads the start screen. */
export const ParkedPinDate = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

export const OrchestrationParkedEntry = Schema.Struct({
  id: ParkedEntryId,
  kind: ParkedEntryKind,
  text: ParkedStoredText,
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
  /**
   * When this client first had the entry acknowledged by an import. Absent the
   * first time. A copy sent once and now neither held nor remembered as removed
   * was removed so long ago its tombstone is gone, so it is skipped.
   */
  sentAt: Schema.optionalKey(IsoDateTime),
});
export type ParkedImportEntry = typeof ParkedImportEntry.Type;

/** A cleared note, remembered so an older copy imported again does not come back. */
export const ParkedNoteTombstone = Schema.Struct({
  id: ParkedEntryId,
  removedAt: IsoDateTime,
});
export type ParkedNoteTombstone = typeof ParkedNoteTombstone.Type;

/**
 * The read model's Parked list. `removedEntryIds` remembers thoughts deleted
 * here and `removedNotes` notes cleared here (absent from older servers), so a
 * client still holding an old copy cannot bring one back by importing it
 * again. Both keep entries removed within `PARKED_TOMBSTONE_MAX_AGE_DAYS`.
 */
export const OrchestrationParkedState = Schema.Struct({
  entries: Schema.Array(OrchestrationParkedEntry),
  removedEntryIds: Schema.Array(ParkedEntryId),
  removedNotes: Schema.optionalKey(Schema.Array(ParkedNoteTombstone)),
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
    removedNotes: Schema.optionalKey(Schema.Array(ParkedNoteTombstone)),
  }),
  Schema.Struct({
    kind: Schema.Literal("upserted"),
    entry: OrchestrationParkedEntry,
  }),
  Schema.Struct({
    kind: Schema.Literal("removed"),
    entryId: ParkedEntryId,
    /** Set when the removal leaves a tombstone (absent for a deleted thread's note). */
    removedAt: Schema.optionalKey(IsoDateTime),
  }),
]);
export type OrchestrationParkedStreamItem = typeof OrchestrationParkedStreamItem.Type;

/** Whether an entry id is a note's (`parkedNoteId`). */
export const isParkedNoteId = (id: string): boolean => id.startsWith("note:");

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
      return {
        entries: sortParkedEntries(item.entries),
        removedEntryIds: item.removedEntryIds,
        removedNotes: item.removedNotes ?? [],
      };
    case "upserted":
      return {
        entries: sortParkedEntries([
          ...state.entries.filter((entry) => entry.id !== item.entry.id),
          item.entry,
        ]),
        removedEntryIds: state.removedEntryIds.filter((id) => id !== item.entry.id),
        removedNotes: (state.removedNotes ?? []).filter((note) => note.id !== item.entry.id),
      };
    case "removed": {
      const entries = state.entries.filter((entry) => entry.id !== item.entryId);
      if (isParkedNoteId(item.entryId)) {
        const removedNotes = (state.removedNotes ?? []).filter((note) => note.id !== item.entryId);
        return {
          entries,
          removedEntryIds: state.removedEntryIds,
          removedNotes: item.removedAt
            ? [...removedNotes, { id: item.entryId, removedAt: item.removedAt }]
            : removedNotes,
        };
      }
      return {
        ...state,
        entries,
        removedEntryIds: state.removedEntryIds.includes(item.entryId)
          ? state.removedEntryIds
          : [...state.removedEntryIds, item.entryId],
      };
    }
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
