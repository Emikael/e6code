/**
 * Keeping a client's Parked list in step with its environment (phase 20).
 *
 * The environment holds the list (`parked.*` commands). A client shows the
 * list it last received with its own unsent changes applied on top, and keeps
 * those changes in a queue it stores on the device. The queue is sent, in
 * order, whenever the environment is connected and has `parkedSync`; a change
 * leaves the queue only once the server has answered it. Changes the server
 * refuses (a thought deleted on another device meanwhile) are dropped: the
 * server's list is the one every device agrees on.
 *
 * Web and mobile share these rules; each stores the queue its own way.
 */
import {
  CommandId,
  ParkedEntryId,
  ProjectId,
  ThreadId,
  parkedNoteId,
  type ClientOrchestrationCommand,
  type OrchestrationParkedEntry,
  type OrchestrationParkedState,
} from "@e6tools/contracts";
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
        createdAt: op.createdAt,
      };
  }
}

const entryIdOf = (op: ParkedOp): string | null => (op.kind === "note" ? null : op.entryId);

/**
 * Adds a change to the queue, folding it into changes not sent yet, so the
 * queue never sends work that a later change undoes: removing a thought whose
 * add is still queued drops both, an edit to a queued add rewrites the add, and
 * a note keeps one queued edit carrying the version the first edit started from.
 */
export function enqueueParkedOp(
  ops: ReadonlyArray<ParkedOp>,
  op: ParkedOp,
): ReadonlyArray<ParkedOp> {
  if (op.kind === "note") {
    const earlier = ops.find(
      (candidate) =>
        candidate.kind === "note" &&
        candidate.environmentId === op.environmentId &&
        candidate.threadId === op.threadId,
    );
    const rest = ops.filter((candidate) => candidate !== earlier);
    return [
      ...rest,
      earlier && earlier.kind === "note" ? { ...op, baseUpdatedAt: earlier.baseUpdatedAt } : op,
    ];
  }
  const sameEntry = (candidate: ParkedOp) =>
    candidate.environmentId === op.environmentId && entryIdOf(candidate) === op.entryId;
  const queuedAdd = ops.find((candidate) => sameEntry(candidate) && candidate.kind === "add");
  switch (op.kind) {
    case "remove":
      if (queuedAdd) return ops.filter((candidate) => !sameEntry(candidate));
      return [...ops.filter((candidate) => !sameEntry(candidate)), op];
    case "update":
      if (queuedAdd && queuedAdd.kind === "add") {
        return ops.map((candidate) =>
          candidate === queuedAdd
            ? { ...queuedAdd, text: op.text, pinnedFor: op.pinnedFor }
            : candidate,
        );
      }
      return [
        ...ops.filter((candidate) => !(sameEntry(candidate) && candidate.kind === "update")),
        op,
      ];
    case "add": {
      // Undo of a removal not sent yet: the server still has the thought.
      const queuedRemove = ops.find(
        (candidate) => sameEntry(candidate) && candidate.kind === "remove",
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
 * Whether a failed send was the server deciding (drop the change) rather than
 * the connection failing (keep it and send again later).
 */
export function isParkedOpRefused(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly _tag?: unknown })._tag === "OrchestrationDispatchCommandError"
  );
}

/** An entry a client kept before its environment could hold it. */
export interface LocalParkedEntry {
  readonly id: string;
  readonly kind: "thought" | "note";
  readonly text: string;
  readonly threadId: ThreadId | null;
}

/**
 * Whether the environment now holds a local entry, so the device may forget
 * its own copy: the thought is in the list (or was removed there), or the
 * thread's note contains the text.
 */
export function isLocalParkedEntryHeld(
  entry: LocalParkedEntry,
  server: OrchestrationParkedState,
): boolean {
  if (entry.kind === "thought") {
    return (
      server.entries.some((candidate) => candidate.id === entry.id) ||
      server.removedEntryIds.includes(ParkedEntryId.make(entry.id))
    );
  }
  return server.entries.some(
    (candidate) =>
      candidate.kind === "note" &&
      candidate.threadId === entry.threadId &&
      candidate.text.includes(entry.text.trim()),
  );
}
