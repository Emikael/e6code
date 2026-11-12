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
const note = (text: string, baseUpdatedAt: string | null): ParkedOp => ({
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

describe("parked queue", () => {
  it("never sends a thought that was removed before it went out", () => {
    let ops = enqueueParkedOp([], add("a"));
    ops = enqueueParkedOp(ops, { ...add("a", "edited"), kind: "update" } as ParkedOp);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "add", text: "edited" });
    expect(enqueueParkedOp(ops, remove("a"))).toEqual([]);
  });

  it("turns Undo of an unsent removal back into the thought the server still has", () => {
    const ops = enqueueParkedOp(enqueueParkedOp([], remove("a")), add("a", "restored"));
    expect(ops).toEqual([expect.objectContaining({ kind: "update", text: "restored" })]);
  });

  it("keeps one queued note edit, carrying the version the first edit started from", () => {
    const ops = enqueueParkedOp(enqueueParkedOp([], note("one", "v1")), note("two", "v2"));
    expect(ops).toEqual([expect.objectContaining({ text: "two", baseUpdatedAt: "v1" })]);
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

  it("drops a change only when the server refused it, not when the connection failed", () => {
    expect(isParkedOpRefused({ _tag: "OrchestrationDispatchCommandError" })).toBe(true);
    expect(isParkedOpRefused({ _tag: "EnvironmentRpcUnavailableError" })).toBe(false);
  });

  it("forgets a local copy only once the server holds it", () => {
    const local = { id: "a", kind: "thought" as const, text: "a", threadId: null };
    expect(isLocalParkedEntryHeld(local, EMPTY_PARKED_STATE)).toBe(false);
    expect(
      isLocalParkedEntryHeld(local, { entries: [], removedEntryIds: [ParkedEntryId.make("a")] }),
    ).toBe(true);
    const localNote = {
      id: "n",
      kind: "note" as const,
      text: " Ask about tablets ",
      threadId: THREAD,
    };
    expect(
      isLocalParkedEntryHeld(localNote, {
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
    ).toBe(true);
  });
});
