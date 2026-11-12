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

const setNote = (
  text: string,
  baseUpdatedAt: string | null,
  baseText?: string | null,
  createdAt = AT,
) => ({
  type: "parked.note.set" as const,
  commandId: CommandId.make(`note-${text}`),
  threadId: THREAD,
  text,
  baseUpdatedAt,
  ...(baseText === undefined ? {} : { baseText }),
  createdAt,
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

  it("replaces a note when the edit started from the text held now, even from an old version", () => {
    let { state } = apply(EMPTY_PARKED_STATE, setNote("A", null, null));
    const firstVersion = state.entries[0]!.updatedAt;
    // The first edit landed but its reply was lost; the second one was queued
    // behind it, starting from the first edit's text.
    state = apply(state, setNote("A plus", firstVersion, "A"), LATER).state;
    state = apply(state, setNote("A plus more", firstVersion, "A plus"), LATER).state;
    expect(state.entries.map((entry) => entry.text)).toEqual(["A plus more"]);
    // Text another device wrote meanwhile is still joined, not replaced.
    state = apply(state, setNote("Elsewhere", null, "A plus"), LATER).state;
    expect(state.entries[0]?.text).toBe("A plus more\n\nElsewhere");
  });

  it("refuses a stale note edit that would join past the joined cap", () => {
    let { state } = apply(EMPTY_PARKED_STATE, setNote("x".repeat(1_000), null, null));
    state = apply(state, setNote("y".repeat(990), null, "old"), LATER).state;
    expect(state.entries[0]?.text).toHaveLength(1_992);
    const decision = apply(state, setNote("z".repeat(500), null, "old"), LATER).decision;
    expect(decision.ok).toBe(false);
  });

  it("does not bring back a note cleared here from an older copy, but takes a newer one", () => {
    let { state } = apply(EMPTY_PARKED_STATE, setNote("Old note", null, null));
    state = apply(state, setNote("", null, "Old note"), LATER).state;
    expect(state.entries).toEqual([]);
    expect(state.removedNotes).toEqual([{ id: parkedNoteId(THREAD), removedAt: LATER }]);
    const note = (text: string, createdAt: string) => ({
      id: ParkedEntryId.make(`local-${text}`),
      kind: "note" as const,
      threadId: THREAD,
      text,
      createdAt,
    });
    state = apply(state, importEntries([note("Old note", AT)]), LATER).state;
    expect(state.entries).toEqual([]);
    state = apply(state, importEntries([note("Written after", "2026-11-12T12:00:00.000Z")])).state;
    expect(state.entries.map((entry) => entry.text)).toEqual(["Written after"]);
    expect(state.removedNotes).toEqual([]);
  });

  it("skips a copy sent once before the oldest tombstone, and takes one never sent", () => {
    const longAgo = "2026-07-01T00:00:00.000Z";
    const { state } = apply(
      EMPTY_PARKED_STATE,
      importEntries([
        { id: ParkedEntryId.make("sent"), text: "sent", sentAt: longAgo },
        { id: ParkedEntryId.make("never-sent"), text: "never sent", createdAt: longAgo },
        { id: ParkedEntryId.make("recent"), text: "recent", sentAt: AT },
      ]),
    );
    expect(state.entries.map((entry) => entry.id).toSorted()).toEqual(["never-sent", "recent"]);
  });

  it("keeps one thought pinned per day when two browsers import one each", () => {
    const pinned = (id: string, createdAt: string) => ({
      id: ParkedEntryId.make(id),
      text: id,
      pinnedFor: "2026-11-13",
      createdAt,
    });
    let { state } = apply(EMPTY_PARKED_STATE, importEntries([pinned("first", AT)]));
    state = apply(state, importEntries([pinned("later", LATER)])).state;
    state = apply(state, importEntries([pinned("earliest", "2026-11-12T08:00:00.000Z")])).state;
    const pinnedIds = state.entries.filter((entry) => entry.pinnedFor !== null).map((e) => e.id);
    expect(pinnedIds).toEqual(["later"]);
    expect(state.entries).toHaveLength(3);
  });
});
