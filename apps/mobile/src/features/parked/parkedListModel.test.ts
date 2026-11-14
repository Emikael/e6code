import {
  EnvironmentId,
  PARKED_NOTES_MAX,
  PARKED_THOUGHTS_MAX,
  ParkedEntryId,
  ThreadId,
  type OrchestrationParkedEntry,
} from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildParkedRows,
  canParkIn,
  parkedProjectFor,
  parkedTarget,
  threadNoteChange,
  threadNoteText,
} from "./parkedListModel";

const STUDIO = EnvironmentId.make("studio");
const LAPTOP = EnvironmentId.make("laptop");

const thought = (id: string, createdAt: string): OrchestrationParkedEntry => ({
  id: ParkedEntryId.make(id),
  kind: "thought",
  text: id,
  projectId: null,
  threadId: null,
  pinnedFor: null,
  createdAt,
  updatedAt: createdAt,
});

describe("buildParkedRows", () => {
  it("lists every environment's thoughts newest first, with unsent changes applied", () => {
    const rows = buildParkedRows(
      new Map([
        [
          STUDIO,
          {
            entries: [
              thought("relay", "2026-11-12T11:32:00.000Z"),
              {
                ...thought("note", "2026-11-12T12:00:00.000Z"),
                kind: "note",
                threadId: ThreadId.make("t"),
              },
            ],
            removedEntryIds: [],
          },
        ],
        [LAPTOP, { entries: [thought("hero", "2026-11-11T09:00:00.000Z")], removedEntryIds: [] }],
      ]),
      [
        {
          kind: "add",
          opId: "op-1",
          environmentId: STUDIO,
          entryId: ParkedEntryId.make("offline"),
          text: "offline",
          projectId: null,
          pinnedFor: null,
          createdAt: "2026-11-12T14:09:00.000Z",
        },
        {
          kind: "remove",
          opId: "op-2",
          environmentId: LAPTOP,
          entryId: ParkedEntryId.make("hero"),
        },
      ],
    );
    expect(rows.map((row) => [row.environmentId, row.entry.id, row.waiting])).toEqual([
      ["studio", "offline", true],
      ["studio", "relay", false],
    ]);
  });

  it("shows thoughts queued for an accepted environment while it is offline", () => {
    const rows = buildParkedRows(
      new Map(),
      [
        {
          kind: "add",
          opId: "op-1",
          environmentId: STUDIO,
          entryId: ParkedEntryId.make("offline"),
          text: "offline",
          projectId: null,
          pinnedFor: null,
          createdAt: "2026-11-12T14:09:00.000Z",
        },
      ],
      [STUDIO],
    );
    expect(rows.map((row) => [row.entry.id, row.waiting])).toEqual([["offline", true]]);
  });

  it("refuses a thought past the cap of its environment", () => {
    const full = Array.from({ length: PARKED_THOUGHTS_MAX }, (_, index) =>
      thought(`t${index}`, "2026-11-12T10:00:00.000Z"),
    );
    const rows = buildParkedRows(new Map([[STUDIO, { entries: full, removedEntryIds: [] }]]), []);
    expect(canParkIn(rows, STUDIO)).toBe(false);
    expect(canParkIn(rows, LAPTOP)).toBe(true);
  });
});

describe("parkedTarget", () => {
  const accepted = [
    { environmentId: "studio", label: "Studio Mac" },
    { environmentId: "laptop", label: "Laptop" },
  ];
  it("parks where the user picked, else the first accepted by name, else nowhere", () => {
    expect(parkedTarget(accepted, "studio")).toBe("studio");
    expect(parkedTarget(accepted, null)).toBe("laptop");
    expect(parkedTarget(accepted, "gone")).toBe("laptop");
    expect(parkedTarget([], null)).toBeNull();
  });
});

describe("parkedProjectFor", () => {
  const projects = [
    { environmentId: "studio", id: "web" },
    { environmentId: "laptop", id: "api" },
  ];

  it("keeps the picked project while it lives where the thought goes", () => {
    expect(parkedProjectFor(projects, "studio", "web")).toBe("web");
  });

  it("files the thought under no project once it goes to another environment", () => {
    expect(parkedProjectFor(projects, "laptop", "web")).toBeNull();
    expect(parkedProjectFor(projects, null, "web")).toBeNull();
    expect(parkedProjectFor(projects, "studio", null)).toBeNull();
  });
});

describe("thread notes", () => {
  const THREAD = ThreadId.make("thread-1");
  const note = (threadId: string, text: string, updatedAt = "2026-11-12T09:00:00.000Z") => ({
    ...thought(`note:${threadId}`, "2026-11-12T08:00:00.000Z"),
    kind: "note" as const,
    text,
    threadId: ThreadId.make(threadId),
    updatedAt,
  });
  const lists = (entries: ReadonlyArray<OrchestrationParkedEntry>) =>
    new Map([[STUDIO, { entries, removedEntryIds: [] }]]);
  const change = (
    entries: ReadonlyArray<OrchestrationParkedEntry>,
    text: string,
    ops: Parameters<typeof threadNoteChange>[0]["ops"] = [],
  ) =>
    threadNoteChange({
      lists: lists(entries),
      ops,
      environmentId: STUDIO,
      threadId: THREAD,
      text,
      opId: "op-1",
      now: "2026-11-13T10:00:00.000Z",
    });

  it("shows the note with this phone's unsent edit applied", () => {
    const saved = lists([note("thread-1", "check the relay")]);
    expect(threadNoteText(saved, [], STUDIO, THREAD)).toBe("check the relay");
    const edit = change([note("thread-1", "check the relay")], "check the relay, then ship");
    if (edit.kind !== "save") throw new Error("expected a change");
    expect(threadNoteText(saved, [edit.op], STUDIO, THREAD)).toBe("check the relay, then ship");
    expect(threadNoteText(saved, [], LAPTOP, THREAD)).toBeNull();
  });

  it("starts an edit from the note shown and the version the environment last sent", () => {
    expect(change([note("thread-1", "old", "2026-11-12T09:30:00.000Z")], "  new  ")).toEqual({
      kind: "save",
      op: {
        kind: "note",
        opId: "op-1",
        environmentId: STUDIO,
        threadId: THREAD,
        text: "new",
        baseUpdatedAt: "2026-11-12T09:30:00.000Z",
        baseText: "old",
        createdAt: "2026-11-13T10:00:00.000Z",
      },
    });
  });

  it("clears the note with empty text, and does nothing when nothing changed", () => {
    const cleared = change([note("thread-1", "old")], "   ");
    expect(cleared.kind === "save" && cleared.op.kind === "note" ? cleared.op.text : null).toBe("");
    expect(change([note("thread-1", "old")], "old ")).toEqual({ kind: "unchanged" });
    expect(change([], "")).toEqual({ kind: "unchanged" });
  });

  it("refuses a new note past the cap but still edits an existing one", () => {
    const full = Array.from({ length: PARKED_NOTES_MAX }, (_, index) =>
      note(`other-${index}`, "x"),
    );
    expect(change(full, "a new note")).toEqual({ kind: "full" });
    expect(change([...full.slice(1), note("thread-1", "old")], "edited").kind).toBe("save");
  });
});
