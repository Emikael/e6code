import {
  EnvironmentId,
  PARKED_THOUGHTS_MAX,
  ParkedEntryId,
  ThreadId,
  type OrchestrationParkedEntry,
} from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildParkedRows, canParkIn, parkedTarget } from "./parkedListModel";

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
