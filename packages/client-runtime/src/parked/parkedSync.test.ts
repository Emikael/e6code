import {
  EMPTY_PARKED_STATE,
  ParkedEntryId,
  ProjectId,
  ThreadId,
  parkedNoteId,
  type OrchestrationParkedEntry,
} from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyParkedOps,
  enqueueParkedOp,
  isLocalParkedEntryHeld,
  isParkedOpRefused,
  mayParkIn,
  parkedHeldIndex,
  parkedOfferQuestion,
  parkedOpCommand,
  parkedOpProblem,
  selectParkedOfferEnvironment,
  type ParkedOp,
} from "./parkedSync.ts";

const ENV = "env-1";
const AT = "2026-11-12T10:00:00.000Z";
const THREAD = ThreadId.make("thread-1");

const add = (id: string, text = id): ParkedOp => ({
  kind: "add",
  opId: `add-${id}-${text}`,
  environmentId: ENV,
  entryId: ParkedEntryId.make(id),
  text,
  projectId: ProjectId.make("project-1"),
  pinnedFor: null,
  createdAt: AT,
});
const remove = (id: string): ParkedOp => ({
  kind: "remove",
  opId: `remove-${id}`,
  environmentId: ENV,
  entryId: ParkedEntryId.make(id),
});
const note = (text: string, baseUpdatedAt: string | null): Extract<ParkedOp, { kind: "note" }> => ({
  kind: "note",
  opId: `note-${text}`,
  environmentId: ENV,
  threadId: THREAD,
  text,
  baseUpdatedAt,
  createdAt: AT,
});

const serverThought = (id: string): OrchestrationParkedEntry => ({
  id: ParkedEntryId.make(id),
  kind: "thought",
  text: id,
  projectId: null,
  threadId: null,
  pinnedFor: null,
  createdAt: AT,
  updatedAt: AT,
});

/** A change queued first for another thought, so the ones under test are not the first. */
const first = add("first");

describe("parked queue", () => {
  it("never sends a thought that was removed before it went out", () => {
    let ops = enqueueParkedOp([first], add("a"));
    ops = enqueueParkedOp(ops, { ...add("a", "edited"), kind: "update" } as ParkedOp);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ kind: "add", text: "edited" });
    expect(enqueueParkedOp(ops, remove("a"))).toEqual([first]);
  });

  it("turns Undo of an unsent removal back into the thought the server still has", () => {
    const ops = enqueueParkedOp(enqueueParkedOp([first], remove("a")), add("a", "restored"));
    expect(ops).toEqual([first, expect.objectContaining({ kind: "update", text: "restored" })]);
  });

  it("folds nothing into the first change, which may already be on its way", () => {
    let ops = enqueueParkedOp([], add("a"));
    ops = enqueueParkedOp(ops, { ...add("a", "edited"), kind: "update" } as ParkedOp);
    expect(ops.map((op) => op.kind)).toEqual(["add", "update"]);
    expect(enqueueParkedOp([add("a")], remove("a")).map((op) => op.kind)).toEqual([
      "add",
      "remove",
    ]);
  });

  it("keeps one unsent note edit, carrying the text the first edit started from", () => {
    const sent = note("zero", "v0");
    const ops = enqueueParkedOp(
      enqueueParkedOp([sent], { ...note("one", "v1"), baseText: "base" }),
      note("two", "v2"),
    );
    expect(ops).toEqual([
      sent,
      expect.objectContaining({ text: "two", baseUpdatedAt: "v0", baseText: "zero" }),
    ]);
  });

  it("starts a note edit queued behind a sent one from that one's text", () => {
    // Edit, the reply is lost, edit again: the resend and the second edit
    // reach the server as "A plus" then "A plus more" from "A plus".
    let ops = enqueueParkedOp([], { ...note("A plus", "v1"), baseText: "A" });
    ops = enqueueParkedOp(ops, note("A plus more", "v1"));
    expect(ops.map((op) => op.kind === "note" && [op.text, op.baseText])).toEqual([
      ["A plus", "A"],
      ["A plus more", "A plus"],
    ]);
    expect(parkedOpCommand(ops[1]!)).toMatchObject({ baseText: "A plus" });
  });

  it("shows the server's list with unsent changes applied", () => {
    const view = applyParkedOps(
      [serverThought("a"), serverThought("b")],
      [remove("a"), add("c"), note("Check iOS", null)],
    );
    expect(view.map((entry) => entry.id).sort()).toEqual(["b", "c", parkedNoteId(THREAD)]);
    expect(applyParkedOps(view, [note("", null)]).some((entry) => entry.kind === "note")).toBe(
      false,
    );
  });

  it("drops a change when it was refused or cannot be encoded, not when the connection failed", () => {
    expect(isParkedOpRefused({ _tag: "OrchestrationDispatchCommandError" })).toBe(true);
    expect(isParkedOpRefused({ _tag: "SchemaError" })).toBe(true);
    expect(isParkedOpRefused({ _tag: "EnvironmentRpcUnavailableError" })).toBe(false);
  });

  it("names a change that can never be sent, such as one over the length limit", () => {
    expect(parkedOpProblem(add("a", "Short"))).toBeNull();
    expect(parkedOpProblem(add("a", "x".repeat(1_001)))).toBe(
      "It is longer than 1,000 characters.",
    );
    expect(parkedOpProblem(note("y".repeat(1_001), null))).not.toBeNull();
    expect(parkedOpProblem({ ...add("a"), pinnedFor: "tomorrow" } as ParkedOp)).not.toBeNull();
  });

  it("forgets a local copy only once the server holds it", () => {
    const local = { id: "a", kind: "thought" as const, text: "a", threadId: null, createdAt: AT };
    expect(isLocalParkedEntryHeld(local, parkedHeldIndex(EMPTY_PARKED_STATE))).toBe(false);
    expect(
      isLocalParkedEntryHeld(
        local,
        parkedHeldIndex({ entries: [], removedEntryIds: [ParkedEntryId.make("a")] }),
      ),
    ).toBe(true);
    const localNote = {
      id: "n",
      kind: "note" as const,
      text: " Ask about tablets ",
      threadId: THREAD,
      createdAt: AT,
    };
    expect(
      isLocalParkedEntryHeld(
        localNote,
        parkedHeldIndex({
          entries: [
            {
              ...serverThought("x"),
              id: parkedNoteId(THREAD),
              kind: "note",
              threadId: THREAD,
              text: "Server note.\n\nAsk about tablets",
            },
          ],
          removedEntryIds: [],
        }),
      ),
    ).toBe(true);
    // Cleared there after this copy was written: gone. Written after the clear: kept.
    const cleared = parkedHeldIndex({
      entries: [],
      removedEntryIds: [],
      removedNotes: [{ id: parkedNoteId(THREAD), removedAt: "2026-11-12T11:00:00.000Z" }],
    });
    expect(isLocalParkedEntryHeld(localNote, cleared)).toBe(true);
    expect(
      isLocalParkedEntryHeld({ ...localNote, createdAt: "2026-11-12T12:00:00.000Z" }, cleared),
    ).toBe(false);
  });
});

describe("saving parked thoughts to an environment", () => {
  it("sends nothing to an environment the user has not accepted", () => {
    expect(mayParkIn({}, "a")).toBe(false);
    expect(mayParkIn({ a: "declined" }, "a")).toBe(false);
    expect(mayParkIn({ a: "accepted" }, "a")).toBe(true);
    expect(mayParkIn({ a: "accepted" }, null)).toBe(false);
  });

  it("offers each environment once, the primary one first", () => {
    const available = ["b", "a"];
    expect(
      selectParkedOfferEnvironment({ consents: {}, available, primaryEnvironmentId: "a" }),
    ).toBe("a");
    expect(
      selectParkedOfferEnvironment({
        consents: { a: "declined" },
        available,
        primaryEnvironmentId: "a",
      }),
    ).toBe("b");
    expect(
      selectParkedOfferEnvironment({
        consents: { a: "accepted", b: "declined" },
        available,
        primaryEnvironmentId: "a",
      }),
    ).toBeNull();
    // An environment that cannot hold a list is never offered.
    expect(
      selectParkedOfferEnvironment({ consents: {}, available: [], primaryEnvironmentId: "a" }),
    ).toBeNull();
  });

  it("asks with what this device holds", () => {
    expect(parkedOfferQuestion({ thoughts: 4, notes: 2 }, "Studio Mac")).toBe(
      "Save 4 parked thoughts and 2 notes to Studio Mac?",
    );
    expect(parkedOfferQuestion({ thoughts: 1, notes: 0 }, "Laptop")).toBe(
      "Save 1 parked thought to Laptop?",
    );
    expect(parkedOfferQuestion({ thoughts: 0, notes: 0 }, "Laptop")).toBe(
      "Save parked thoughts and notes to Laptop?",
    );
  });
});
