import {
  EMPTY_PARKED_STATE,
  CommandId,
  EventId,
  PARKED_LIST_ID,
  PARKED_THOUGHTS_MAX,
  ParkedEntryId,
  ProjectId,
  ThreadId,
  parkedNoteId,
  type OrchestrationEvent,
  type OrchestrationParkedState,
  type OrchestrationReadModel,
} from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decideParkedCommand, projectParkedEvent, type ParkedDecision } from "./parked.ts";

const AT = "2026-11-12T10:00:00.000Z";
const LATER = "2026-11-12T11:00:00.000Z";
const THREAD = ThreadId.make("thread-1");

function readModel(
  parked: OrchestrationParkedState = EMPTY_PARKED_STATE,
  deletedAt: string | null = null,
): Pick<OrchestrationReadModel, "parked" | "threads"> {
  return {
    parked,
    threads: [{ id: THREAD, deletedAt } as OrchestrationReadModel["threads"][number]],
  };
}

/** Decides a command and folds its event, as the engine does. */
function apply(
  state: OrchestrationParkedState,
  command: Parameters<typeof decideParkedCommand>[0]["command"],
  occurredAt = AT,
): { state: OrchestrationParkedState; decision: ParkedDecision } {
  const decision = decideParkedCommand({ command, readModel: readModel(state), occurredAt });
  if (!decision.ok) return { state, decision };
  const event = {
    ...decision.event,
    sequence: 1,
    eventId: EventId.make("event"),
    aggregateKind: "parked",
    aggregateId: PARKED_LIST_ID,
    occurredAt,
    commandId: CommandId.make("command"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
  } as Extract<OrchestrationEvent, { readonly type: `parked.${string}` }>;
  return { state: projectParkedEvent(state, event), decision };
}

const addThought = (id: string, text = `thought ${id}`) => ({
  type: "parked.thought.add" as const,
  commandId: CommandId.make(`add-${id}`),
  entryId: ParkedEntryId.make(id),
  text,
  projectId: ProjectId.make("project-1"),
  pinnedFor: null,
  createdAt: AT,
});

const setNote = (text: string, baseUpdatedAt: string | null) => ({
  type: "parked.note.set" as const,
  commandId: CommandId.make(`note-${text}`),
  threadId: THREAD,
  text,
  baseUpdatedAt,
  createdAt: AT,
});

const importEntries = (entries: ReadonlyArray<Record<string, unknown>>) => ({
  type: "parked.import" as const,
  commandId: CommandId.make("import"),
  createdAt: AT,
  entries: entries.map((entry) => ({
    kind: "thought" as const,
    projectId: null,
    threadId: null,
    pinnedFor: null,
    createdAt: AT,
    ...entry,
  })) as never,
});

describe("parked aggregate", () => {
  it("keeps one copy when the same local list is imported twice", () => {
    const local = [
      { id: ParkedEntryId.make("a"), text: "Try view transitions" },
      { id: ParkedEntryId.make("b"), text: "Flaky relay test" },
    ];
    let { state } = apply(EMPTY_PARKED_STATE, importEntries(local));
    const second = apply(state, importEntries(local));
    state = second.state;
    expect(state.entries.map((entry) => entry.id).toSorted()).toEqual(["a", "b"]);
    expect(second.decision).toMatchObject({ ok: true, event: { payload: { entries: [] } } });
  });

  it("does not bring back a thought removed here when an old copy is imported", () => {
    let { state } = apply(EMPTY_PARKED_STATE, addThought("a"));
    state = apply(state, {
      type: "parked.entry.remove",
      commandId: CommandId.make("remove"),
      entryId: ParkedEntryId.make("a"),
    }).state;
    state = apply(state, importEntries([{ id: ParkedEntryId.make("a"), text: "thought a" }])).state;
    expect(state.entries).toEqual([]);
    // An explicit add, such as Undo, may bring it back.
    state = apply(state, addThought("a")).state;
    expect(state.entries.map((entry) => entry.id)).toEqual(["a"]);
    expect(state.removedEntryIds).toEqual([]);
  });

  it("refuses a thought past the cap and skips it on import, evicting nothing", () => {
    let state = EMPTY_PARKED_STATE;
    for (let index = 0; index < PARKED_THOUGHTS_MAX; index += 1) {
      state = apply(state, addThought(`t${index}`)).state;
    }
    expect(apply(state, addThought("over")).decision).toEqual({
      ok: false,
      detail: "Parked is full. Remove one to add another.",
    });
    const imported = apply(state, importEntries([{ id: ParkedEntryId.make("over"), text: "x" }]));
    expect(imported.state.entries).toHaveLength(PARKED_THOUGHTS_MAX);
    expect(imported.state.entries.some((entry) => entry.id === "t0")).toBe(true);
  });

  it("joins a note edit made from an older version instead of replacing it", () => {
    let { state } = apply(EMPTY_PARKED_STATE, setNote("Check dark mode on Android.", null));
    const firstVersion = state.entries[0]!.updatedAt;
    // Another device edits the note.
    state = apply(state, setNote("Check dark mode on iOS.", firstVersion), LATER).state;
    // This device edits from the first version, offline.
    state = apply(state, setNote("Ask about tablets.", firstVersion), LATER).state;
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      id: parkedNoteId(THREAD),
      text: "Check dark mode on iOS.\n\nAsk about tablets.",
    });
    // A clear from the stale version leaves the newer note alone.
    expect(apply(state, setNote("", firstVersion)).decision.ok).toBe(false);
    state = apply(state, setNote("", state.entries[0]!.updatedAt)).state;
    expect(state.entries).toEqual([]);
  });

  it("merges an imported note into the thread's note and skips text it already holds", () => {
    let { state } = apply(EMPTY_PARKED_STATE, setNote("Server note.", null));
    const note = (text: string) => ({
      id: ParkedEntryId.make("local-note"),
      kind: "note" as const,
      threadId: THREAD,
      text,
    });
    state = apply(state, importEntries([note("Server note.")])).state;
    expect(state.entries[0]?.text).toBe("Server note.");
    state = apply(state, importEntries([note("Local note.")])).state;
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.text).toBe("Server note.\n\nLocal note.");
  });

  it("refuses a note on a deleted thread, and a thread's deletion removes its note", () => {
    const deleted = decideParkedCommand({
      command: setNote("Too late", null),
      readModel: readModel(EMPTY_PARKED_STATE, AT),
      occurredAt: AT,
    });
    expect(deleted.ok).toBe(false);
    const { state } = apply(EMPTY_PARKED_STATE, setNote("Note", null));
    const afterDelete = projectParkedEvent(state, {
      type: "thread.deleted",
      payload: { threadId: THREAD, deletedAt: LATER },
    } as Extract<OrchestrationEvent, { readonly type: "thread.deleted" }>);
    expect(afterDelete.entries).toEqual([]);
  });
});
