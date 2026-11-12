/**
 * The `parked` aggregate: one Parked list per environment (`PARKED_LIST_ID`),
 * holding parked thoughts and one note to self per thread. Pure rules only;
 * `decider.ts` and `projector.ts` call these and own the event envelope.
 *
 * Rules that make syncing safe for clients that were offline or ran an older
 * build:
 * - Import is idempotent. An entry the list already holds, or a thought it
 *   removed, is skipped, so two tabs or browsers uploading the same local list
 *   keep one copy and a stale copy cannot bring a deleted thought back.
 * - A note edit made from an older version of the note never replaces text
 *   the editing client did not see: the two texts are joined instead, and a
 *   stale clear leaves the newer note alone. A cleared note leaves a
 *   tombstone, so an older copy imported again does not come back.
 * - Past a cap a new entry is refused (import skips it); nothing is evicted.
 * - One thought leads each day: an import that brings a second thought pinned
 *   for the same day keeps the later one pinned.
 */
import {
  EMPTY_PARKED_STATE,
  PARKED_NOTE_JOINED_MAX_CHARS,
  PARKED_NOTES_MAX,
  PARKED_THOUGHTS_MAX,
  PARKED_TOMBSTONE_MAX_AGE_MS,
  parkedNoteId,
  pruneParkedTombstones,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationParkedEntry,
  type OrchestrationParkedState,
  type OrchestrationParkedStreamItem,
  type OrchestrationReadModel,
  type ParkedEntryId,
  type ThreadId,
} from "@e6tools/contracts";

type ParkedCommand = Extract<OrchestrationCommand, { readonly type: `parked.${string}` }>;
type ParkedEvent = Extract<OrchestrationEvent, { readonly type: `parked.${string}` }>;

/** An event the decider wraps with its envelope: type and payload only. */
export type PlannedParkedEvent = {
  [Type in ParkedEvent["type"]]: {
    readonly type: Type;
    readonly payload: Extract<ParkedEvent, { readonly type: Type }>["payload"];
  };
}[ParkedEvent["type"]];

export type ParkedDecision =
  | { readonly ok: true; readonly event: PlannedParkedEvent }
  | { readonly ok: false; readonly detail: string };

export const isParkedCommand = (command: OrchestrationCommand): command is ParkedCommand =>
  command.type.startsWith("parked.");

export function parkedStateOf(readModel: Pick<OrchestrationReadModel, "parked">) {
  return readModel.parked ?? EMPTY_PARKED_STATE;
}

const countKind = (state: OrchestrationParkedState, kind: OrchestrationParkedEntry["kind"]) =>
  state.entries.reduce((count, entry) => (entry.kind === kind ? count + 1 : count), 0);

const findEntry = (state: OrchestrationParkedState, entryId: ParkedEntryId) =>
  state.entries.find((entry) => entry.id === entryId);

const findNote = (state: OrchestrationParkedState, threadId: ThreadId) =>
  state.entries.find((entry) => entry.kind === "note" && entry.threadId === threadId);

/** Joins a note written elsewhere with this edit, keeping both texts. */
function joinNoteText(current: string, incoming: string): string {
  return current.includes(incoming) ? current : `${current}\n\n${incoming}`;
}

/**
 * Whether a note edit was made from a version other than the one held now. The
 * text the client saw decides when it says (newer clients); else the version.
 */
function isStaleNoteEdit(
  existing: OrchestrationParkedEntry | undefined,
  command: Extract<ParkedCommand, { readonly type: "parked.note.set" }>,
): boolean {
  if (existing === undefined) return false;
  if (command.baseText !== undefined) return existing.text !== (command.baseText ?? "");
  return command.baseUpdatedAt !== existing.updatedAt;
}

/** Whether an import names an entry this client sent before the oldest tombstone kept here. */
const sentBeforeTombstones = (sentAt: string | undefined, occurredAt: string) =>
  sentAt !== undefined && Date.parse(occurredAt) - Date.parse(sentAt) > PARKED_TOMBSTONE_MAX_AGE_MS;

const reject = (detail: string): ParkedDecision => ({ ok: false, detail });

export function decideParkedCommand(input: {
  readonly command: ParkedCommand;
  readonly readModel: Pick<OrchestrationReadModel, "parked" | "threads">;
  readonly occurredAt: string;
}): ParkedDecision {
  const { command, occurredAt } = input;
  // Tombstones past their age no longer block anything, as after a restart.
  const state = pruneParkedTombstones(parkedStateOf(input.readModel), Date.parse(occurredAt));
  const threadIsLive = (threadId: ThreadId) =>
    input.readModel.threads.some((thread) => thread.id === threadId && thread.deletedAt == null);

  switch (command.type) {
    case "parked.thought.add": {
      if (findEntry(state, command.entryId)) {
        return reject(`thought ${command.entryId} is already parked`);
      }
      if (countKind(state, "thought") >= PARKED_THOUGHTS_MAX) {
        return reject("Parked is full. Remove one to add another.");
      }
      // A removed id may come back here: this is an explicit add, such as Undo.
      return {
        ok: true,
        event: {
          type: "parked.thought-added",
          payload: {
            entry: {
              id: command.entryId,
              kind: "thought",
              text: command.text,
              projectId: command.projectId,
              threadId: null,
              pinnedFor: command.pinnedFor,
              createdAt: command.createdAt,
              updatedAt: occurredAt,
            },
          },
        },
      };
    }

    case "parked.thought.update": {
      const entry = findEntry(state, command.entryId);
      if (!entry || entry.kind !== "thought") {
        return reject(`thought ${command.entryId} is not parked`);
      }
      return {
        ok: true,
        event: {
          type: "parked.thought-updated",
          payload: {
            entry: {
              ...entry,
              text: command.text,
              pinnedFor: command.pinnedFor,
              updatedAt: occurredAt,
            },
          },
        },
      };
    }

    case "parked.entry.remove": {
      if (!findEntry(state, command.entryId)) {
        return reject(`entry ${command.entryId} is not parked`);
      }
      return {
        ok: true,
        event: {
          type: "parked.entry-removed",
          payload: { entryId: command.entryId, removedAt: occurredAt },
        },
      };
    }

    case "parked.note.set": {
      if (!threadIsLive(command.threadId)) {
        return reject(`thread ${command.threadId} does not exist`);
      }
      const existing = findNote(state, command.threadId);
      const stale = isStaleNoteEdit(existing, command);
      if (command.text.length === 0) {
        if (!existing) return reject(`thread ${command.threadId} has no note`);
        // A clear made from an older note must not remove text written since.
        if (stale) return reject(`the note on ${command.threadId} changed since it was read`);
        return {
          ok: true,
          event: {
            type: "parked.entry-removed",
            payload: { entryId: existing.id, removedAt: occurredAt },
          },
        };
      }
      if (!existing && countKind(state, "note") >= PARKED_NOTES_MAX) {
        return reject("Note limit reached. Clear one to add another.");
      }
      const text = existing && stale ? joinNoteText(existing.text, command.text) : command.text;
      if (text.length > PARKED_NOTE_JOINED_MAX_CHARS) {
        return reject(
          `the note on ${command.threadId} changed since it was read and is too long to join`,
        );
      }
      return {
        ok: true,
        event: {
          type: "parked.note-set",
          payload: {
            entry: {
              id: existing?.id ?? parkedNoteId(command.threadId),
              kind: "note",
              text,
              projectId: null,
              threadId: command.threadId,
              pinnedFor: null,
              createdAt: existing?.createdAt ?? command.createdAt,
              updatedAt: occurredAt,
            },
          },
        },
      };
    }

    case "parked.import": {
      let next = state;
      const imported = new Map<string, OrchestrationParkedEntry>();
      const keep = (entry: OrchestrationParkedEntry) => {
        imported.set(entry.id, entry);
        next = projectParkedEntry(next, entry);
      };
      const removedThoughts = new Set<string>(state.removedEntryIds);
      const removedNotes = new Map(
        (state.removedNotes ?? []).map((note) => [note.id as string, note.removedAt]),
      );
      for (const candidate of command.entries) {
        if (candidate.kind === "thought") {
          if (findEntry(next, candidate.id) || removedThoughts.has(candidate.id)) continue;
          if (sentBeforeTombstones(candidate.sentAt, occurredAt)) continue;
          if (countKind(next, "thought") >= PARKED_THOUGHTS_MAX) continue;
          let pinnedFor = candidate.pinnedFor;
          if (pinnedFor !== null) {
            // One thought leads a day: the later one keeps the pin.
            const rival = next.entries.find(
              (entry) => entry.kind === "thought" && entry.pinnedFor === pinnedFor,
            );
            if (rival && rival.createdAt > candidate.createdAt) pinnedFor = null;
            else if (rival) keep({ ...rival, pinnedFor: null, updatedAt: occurredAt });
          }
          keep({
            id: candidate.id,
            kind: "thought",
            text: candidate.text,
            projectId: candidate.projectId,
            threadId: null,
            pinnedFor,
            createdAt: candidate.createdAt,
            updatedAt: occurredAt,
          });
          continue;
        }
        const threadId = candidate.threadId;
        if (threadId === null || !threadIsLive(threadId)) continue;
        const existing = findNote(next, threadId);
        if (existing) {
          if (existing.text.includes(candidate.text)) continue;
          const text = joinNoteText(existing.text, candidate.text);
          if (text.length > PARKED_NOTE_JOINED_MAX_CHARS) continue;
          keep({ ...existing, text, updatedAt: occurredAt });
          continue;
        }
        // A copy written before the note was cleared here stays cleared.
        const clearedAt = removedNotes.get(parkedNoteId(threadId));
        if (clearedAt !== undefined && candidate.createdAt <= clearedAt) continue;
        if (sentBeforeTombstones(candidate.sentAt, occurredAt)) continue;
        if (countKind(next, "note") >= PARKED_NOTES_MAX) continue;
        keep({
          id: parkedNoteId(threadId),
          kind: "note",
          text: candidate.text,
          projectId: null,
          threadId,
          pinnedFor: null,
          createdAt: candidate.createdAt,
          updatedAt: occurredAt,
        });
      }
      // Always one event, even when nothing was new: the import is acknowledged either way.
      return {
        ok: true,
        event: { type: "parked.imported", payload: { entries: [...imported.values()] } },
      };
    }
  }
}

function projectParkedEntry(
  state: OrchestrationParkedState,
  entry: OrchestrationParkedEntry,
): OrchestrationParkedState {
  const index = state.entries.findIndex((candidate) => candidate.id === entry.id);
  const removedNotes = state.removedNotes ?? [];
  const removedThoughts = state.removedThoughts ?? [];
  return {
    entries:
      index === -1
        ? [...state.entries, entry]
        : state.entries.map((candidate, position) => (position === index ? entry : candidate)),
    removedEntryIds: state.removedEntryIds.includes(entry.id)
      ? state.removedEntryIds.filter((id) => id !== entry.id)
      : state.removedEntryIds,
    removedNotes: removedNotes.some((note) => note.id === entry.id)
      ? removedNotes.filter((note) => note.id !== entry.id)
      : removedNotes,
    removedThoughts: removedThoughts.some((tombstone) => tombstone.id === entry.id)
      ? removedThoughts.filter((tombstone) => tombstone.id !== entry.id)
      : removedThoughts,
  };
}

/**
 * Removes an entry, leaving a tombstone, and forgets tombstones past their age,
 * as the stored list does on each removal.
 */
function removeParkedEntry(
  state: OrchestrationParkedState,
  entryId: ParkedEntryId,
  removedAt: string,
): OrchestrationParkedState {
  const entry = findEntry(state, entryId);
  if (!entry) return state;
  const entries = state.entries.filter((candidate) => candidate.id !== entryId);
  const tombstone = { id: entryId, removedAt };
  const next: OrchestrationParkedState =
    entry.kind === "note"
      ? {
          ...state,
          entries,
          removedNotes: [
            ...(state.removedNotes ?? []).filter((note) => note.id !== entryId),
            tombstone,
          ],
        }
      : {
          ...state,
          entries,
          removedEntryIds: state.removedEntryIds.includes(entryId)
            ? state.removedEntryIds
            : [...state.removedEntryIds, entryId],
          removedThoughts: [
            ...(state.removedThoughts ?? []).filter((removed) => removed.id !== entryId),
            tombstone,
          ],
        };
  return pruneParkedTombstones(next, Date.parse(removedAt));
}

/**
 * Applies one event to the Parked list. A thread's deletion takes its note
 * with it; archiving keeps it, so unarchive brings the thread back whole.
 */
export function projectParkedEvent(
  state: OrchestrationParkedState,
  event: ParkedEvent | Extract<OrchestrationEvent, { readonly type: "thread.deleted" }>,
): OrchestrationParkedState {
  switch (event.type) {
    case "parked.thought-added":
    case "parked.thought-updated":
    case "parked.note-set":
      return projectParkedEntry(state, event.payload.entry);
    case "parked.entry-removed":
      return removeParkedEntry(state, event.payload.entryId, event.payload.removedAt);
    case "parked.imported":
      return event.payload.entries.reduce(projectParkedEntry, state);
    case "thread.deleted": {
      const note = findNote(state, event.payload.threadId);
      return note
        ? { ...state, entries: state.entries.filter((entry) => entry.id !== note.id) }
        : state;
    }
  }
}

/**
 * What a Parked subscriber is told about one event. Every item carries the
 * entry as it now stands, so a duplicate (an event also in the snapshot the
 * subscriber just read) is harmless.
 */
export function parkedStreamItemsForEvent(
  event: OrchestrationEvent,
): ReadonlyArray<OrchestrationParkedStreamItem> {
  switch (event.type) {
    case "parked.thought-added":
    case "parked.thought-updated":
    case "parked.note-set":
      return [{ kind: "upserted", entry: event.payload.entry }];
    case "parked.imported":
      return event.payload.entries.map((entry) => ({ kind: "upserted" as const, entry }));
    case "parked.entry-removed":
      return [
        { kind: "removed", entryId: event.payload.entryId, removedAt: event.payload.removedAt },
      ];
    case "thread.deleted":
      return [{ kind: "removed", entryId: parkedNoteId(event.payload.threadId) }];
    default:
      return [];
  }
}
