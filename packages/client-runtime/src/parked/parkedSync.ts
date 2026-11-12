/**
 * Keeping a client's Parked list in step with its environment (phase 20).
 *
 * Thoughts and notes are personal and anyone paired with an environment can
 * read its list, so nothing parked goes to an environment until the user
 * accepts saving there (`ParkedConsents`), asked once per environment.
 *
 * An accepted environment holds the list (`parked.*` commands). A client shows
 * the list it last received with its own unsent changes applied on top, and
 * keeps those changes in a queue it stores on the device. The queue is sent,
 * in order and one change at a time, whenever the environment is connected
 * and has `parkedSync`; a change leaves the queue only once the server has
 * answered it. A change the server refuses, or one that cannot be sent at all
 * (`parkedOpProblem`), leaves the queue too, so it never blocks the changes
 * behind it; each client keeps any text it carried and says so.
 *
 * Web and mobile share these rules; each stores the queue its own way.
 */
import {
  ClientOrchestrationCommand,
  CommandId,
  PARKED_TEXT_MAX_CHARS,
  ParkedEntryId,
  ProjectId,
  ThreadId,
  parkedNoteId,
  type OrchestrationParkedEntry,
  type OrchestrationParkedState,
} from "@e6tools/contracts";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

const ParkedOpBase = {
  /** Unique per change; also the command id, so a retry is recognised by the server. */
  opId: Schema.String,
  environmentId: Schema.String,
};

/** One unsent change, as a device stores it until the server answers. */
export const ParkedOp = Schema.Union([
  Schema.Struct({
    ...ParkedOpBase,
    kind: Schema.Literal("add"),
    entryId: ParkedEntryId,
    text: Schema.String,
    projectId: Schema.NullOr(ProjectId),
    pinnedFor: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
  }),
  Schema.Struct({
    ...ParkedOpBase,
    kind: Schema.Literal("update"),
    entryId: ParkedEntryId,
    text: Schema.String,
    pinnedFor: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ ...ParkedOpBase, kind: Schema.Literal("remove"), entryId: ParkedEntryId }),
  Schema.Struct({
    ...ParkedOpBase,
    kind: Schema.Literal("note"),
    threadId: ThreadId,
    /** Empty clears the note. */
    text: Schema.String,
    /** The version of the note this device last saw; see `parked.note.set`. */
    baseUpdatedAt: Schema.NullOr(Schema.String),
    /** The note text the edit started from (null: none). Absent on changes queued by older builds. */
    baseText: Schema.optionalKey(Schema.NullOr(Schema.String)),
    createdAt: Schema.String,
  }),
]);
export type ParkedOp = typeof ParkedOp.Type;

/** The command that sends one queued change. */
export function parkedOpCommand(op: ParkedOp): ClientOrchestrationCommand {
  const commandId = CommandId.make(op.opId);
  switch (op.kind) {
    case "add":
      return {
        type: "parked.thought.add",
        commandId,
        entryId: op.entryId,
        text: op.text,
        projectId: op.projectId,
        pinnedFor: op.pinnedFor,
        createdAt: op.createdAt,
      };
    case "update":
      return {
        type: "parked.thought.update",
        commandId,
        entryId: op.entryId,
        text: op.text,
        pinnedFor: op.pinnedFor,
      };
    case "remove":
      return { type: "parked.entry.remove", commandId, entryId: op.entryId };
    case "note":
      return {
        type: "parked.note.set",
        commandId,
        threadId: op.threadId,
        text: op.text,
        baseUpdatedAt: op.baseUpdatedAt,
        ...(op.baseText === undefined ? {} : { baseText: op.baseText }),
        createdAt: op.createdAt,
      };
  }
}

const decodeClientCommand = Schema.decodeUnknownExit(ClientOrchestrationCommand);

/**
 * Why a queued change cannot be sent as it is, or null when it can. Such a
 * change would fail before it reached the server, every time, so the client
 * settles it as refused instead of retrying it forever.
 */
export function parkedOpProblem(op: ParkedOp): string | null {
  if (
    (op.kind === "add" || op.kind === "update" || op.kind === "note") &&
    op.text.trim().length > PARKED_TEXT_MAX_CHARS
  ) {
    return `It is longer than ${PARKED_TEXT_MAX_CHARS.toLocaleString("en-US")} characters.`;
  }
  return Exit.isSuccess(decodeClientCommand(parkedOpCommand(op)))
    ? null
    : "It could not be read as a Parked change.";
}

const entryIdOf = (op: ParkedOp): string | null => (op.kind === "note" ? null : op.entryId);

/**
 * Adds a change to the queue, folding it into changes not sent yet, so the
 * queue never sends work that a later change undoes: removing a thought whose
 * add is still queued drops both, an edit to a queued add rewrites the add, and
 * a note keeps one queued edit carrying the text the first edit started from.
 *
 * The first change queued for an environment may already be on its way, or
 * have landed with its reply lost, so nothing is folded into it: a resend
 * carries the same command id, which the server answers without applying a
 * second time. A note edit queued behind it starts from its text instead.
 */
export function enqueueParkedOp(
  ops: ReadonlyArray<ParkedOp>,
  op: ParkedOp,
): ReadonlyArray<ParkedOp> {
  const head = ops.find((candidate) => candidate.environmentId === op.environmentId);
  const unsent = (candidate: ParkedOp | undefined) => candidate !== undefined && candidate !== head;
  if (op.kind === "note") {
    // The latest one (Hermes lacks `findLast`).
    let earlier: ParkedOp | undefined;
    for (const candidate of ops) {
      if (
        candidate.kind === "note" &&
        candidate.environmentId === op.environmentId &&
        candidate.threadId === op.threadId
      ) {
        earlier = candidate;
      }
    }
    if (earlier?.kind !== "note") return [...ops, op];
    if (unsent(earlier)) {
      return [
        ...ops.filter((candidate) => candidate !== earlier),
        {
          ...op,
          baseUpdatedAt: earlier.baseUpdatedAt,
          ...(earlier.baseText === undefined ? {} : { baseText: earlier.baseText }),
        },
      ];
    }
    return [
      ...ops,
      {
        ...op,
        baseUpdatedAt: earlier.baseUpdatedAt,
        baseText: earlier.text.length > 0 ? earlier.text : null,
      },
    ];
  }
  const sameEntry = (candidate: ParkedOp) =>
    candidate.environmentId === op.environmentId && entryIdOf(candidate) === op.entryId;
  const queuedAdd = ops.find(
    (candidate) => sameEntry(candidate) && candidate.kind === "add" && unsent(candidate),
  );
  const foldable = (candidate: ParkedOp) => sameEntry(candidate) && unsent(candidate);
  switch (op.kind) {
    case "remove":
      if (queuedAdd) return ops.filter((candidate) => !foldable(candidate));
      return [...ops.filter((candidate) => !foldable(candidate)), op];
    case "update":
      if (queuedAdd && queuedAdd.kind === "add") {
        return ops.map((candidate) =>
          candidate === queuedAdd
            ? { ...queuedAdd, text: op.text, pinnedFor: op.pinnedFor }
            : candidate,
        );
      }
      return [
        ...ops.filter((candidate) => !(foldable(candidate) && candidate.kind === "update")),
        op,
      ];
    case "add": {
      // Undo of a removal not sent yet: the server still has the thought.
      const queuedRemove = ops.find(
        (candidate) => foldable(candidate) && candidate.kind === "remove",
      );
      if (queuedRemove) {
        return [
          ...ops.filter((candidate) => candidate !== queuedRemove),
          {
            kind: "update",
            opId: op.opId,
            environmentId: op.environmentId,
            entryId: op.entryId,
            text: op.text,
            pinnedFor: op.pinnedFor,
          },
        ];
      }
      return [...ops, op];
    }
  }
}

/**
 * The list a client shows: the server's list with this device's unsent changes
 * for that environment applied, newest first.
 */
export function applyParkedOps(
  entries: ReadonlyArray<OrchestrationParkedEntry>,
  ops: ReadonlyArray<ParkedOp>,
): ReadonlyArray<OrchestrationParkedEntry> {
  let next = [...entries];
  for (const op of ops) {
    switch (op.kind) {
      case "add":
        if (!next.some((entry) => entry.id === op.entryId)) {
          next.push({
            id: op.entryId,
            kind: "thought",
            text: op.text,
            projectId: op.projectId,
            threadId: null,
            pinnedFor: op.pinnedFor,
            createdAt: op.createdAt,
            updatedAt: op.createdAt,
          });
        }
        break;
      case "update":
        next = next.map((entry) =>
          entry.id === op.entryId ? { ...entry, text: op.text, pinnedFor: op.pinnedFor } : entry,
        );
        break;
      case "remove":
        next = next.filter((entry) => entry.id !== op.entryId);
        break;
      case "note": {
        const existing = next.find(
          (entry) => entry.kind === "note" && entry.threadId === op.threadId,
        );
        next = next.filter((entry) => entry !== existing);
        if (op.text.length > 0) {
          next.push({
            id: existing?.id ?? parkedNoteId(op.threadId),
            kind: "note",
            text: op.text,
            projectId: null,
            threadId: op.threadId,
            pinnedFor: null,
            createdAt: existing?.createdAt ?? op.createdAt,
            updatedAt: existing?.updatedAt ?? op.createdAt,
          });
        }
        break;
      }
    }
  }
  return [...next].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

/**
 * Whether a failed send was decided (the server refused it, or it could not be
 * encoded, which would fail the same way every time) rather than the
 * connection failing (keep it and send again later).
 */
export function isParkedOpRefused(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const tag = (error as { readonly _tag?: unknown })._tag;
  return tag === "OrchestrationDispatchCommandError" || tag === "SchemaError";
}

/** An entry a client kept before its environment could hold it. */
export interface LocalParkedEntry {
  readonly id: string;
  readonly kind: "thought" | "note";
  readonly text: string;
  readonly threadId: ThreadId | null;
  /** When the copy was written; a note cleared on the server after it is gone. */
  readonly createdAt: string;
}

/** Lookups over a server's list, built once per list rather than once per entry. */
export function parkedHeldIndex(server: OrchestrationParkedState) {
  const ids = new Set<string>(server.removedEntryIds);
  const notes = new Map<string, string>();
  for (const entry of server.entries) {
    ids.add(entry.id);
    if (entry.kind === "note" && entry.threadId) notes.set(entry.threadId, entry.text);
  }
  const clearedNotes = new Map<string, string>(
    (server.removedNotes ?? []).map((note) => [note.id, note.removedAt]),
  );
  return { ids, notes, clearedNotes };
}
export type ParkedHeldIndex = ReturnType<typeof parkedHeldIndex>;

/**
 * Whether the environment now holds a local entry, so the device may forget
 * its own copy: the thought is in the list (or was removed there), or the
 * thread's note contains the text, or the note was cleared there after this
 * copy was written.
 */
export function isLocalParkedEntryHeld(entry: LocalParkedEntry, held: ParkedHeldIndex): boolean {
  if (entry.kind === "thought") return held.ids.has(entry.id);
  if (entry.threadId === null) return false;
  if (held.notes.get(entry.threadId)?.includes(entry.text.trim())) return true;
  const clearedAt = held.clearedNotes.get(parkedNoteId(entry.threadId));
  return clearedAt !== undefined && entry.createdAt <= clearedAt;
}

/** The user's answer, per environment, to saving parked thoughts and notes there. */
export const ParkedConsent = Schema.Literals(["accepted", "declined"]);
export type ParkedConsent = typeof ParkedConsent.Type;
export const ParkedConsents = Schema.Record(Schema.String, ParkedConsent);
export type ParkedConsents = typeof ParkedConsents.Type;

/** Whether anything parked may be sent to `environmentId`: only once the user accepted it. */
export function mayParkIn(consents: ParkedConsents, environmentId: string | null): boolean {
  return environmentId !== null && consents[environmentId] === "accepted";
}

/**
 * The environment to offer saving to, or null. Only an environment that can
 * hold a list (`available`) and that the user has not answered for is offered,
 * the primary one first; an answer is never asked again.
 */
export function selectParkedOfferEnvironment(input: {
  readonly consents: ParkedConsents;
  readonly available: ReadonlyArray<string>;
  readonly primaryEnvironmentId: string | null;
}): string | null {
  const open = input.available.filter((id) => input.consents[id] === undefined);
  if (input.primaryEnvironmentId !== null && open.includes(input.primaryEnvironmentId)) {
    return input.primaryEnvironmentId;
  }
  return open[0] ?? null;
}

const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** "Save 4 parked thoughts and 2 notes to Studio Mac?", with what is on this device now. */
export function parkedOfferQuestion(
  counts: { readonly thoughts: number; readonly notes: number },
  environmentLabel: string,
): string {
  const parts = [
    ...(counts.thoughts > 0 ? [counted(counts.thoughts, "parked thought", "parked thoughts")] : []),
    ...(counts.notes > 0 ? [counted(counts.notes, "note", "notes")] : []),
  ];
  const what = parts.length > 0 ? parts.join(" and ") : "parked thoughts and notes";
  return `Save ${what} to ${environmentLabel}?`;
}

/** What saving there means, said with the offer. */
export function parkedOfferDetail(environmentLabel: string): string {
  return `Your other devices see them too, and anyone paired with ${environmentLabel} can read them.`;
}
