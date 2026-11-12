import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  firstThingSource,
  formatParkedWhen,
  localDateKey,
  nextLocalDateKey,
  parkedFooterLines,
  parkedLengthCount,
  parkThought,
  removeParkedEntry,
  selectFirstThing,
  selectParkedChips,
  selectParkedThoughts,
} from "./parkedThoughts";
import {
  MAX_PARKED_THOUGHTS,
  PARKED_FULL_MESSAGE,
  usePromptStashStore,
  writePromptStashStorageForTest,
  type PromptStashEntry,
} from "./promptStashStore";

/** Seeds the stored list, which every write re-reads first. */
const seed = (entries: ReadonlyArray<PromptStashEntry>) =>
  writePromptStashStorageForTest(JSON.stringify({ version: 2, state: { entries } }));

const entry = (id: string, overrides: Partial<PromptStashEntry> = {}): PromptStashEntry => ({
  id,
  createdAt: "2026-11-12T14:09:00.000Z",
  prompt: `prompt ${id}`,
  attachments: [],
  droppedImageNames: [],
  kind: "thought",
  ...overrides,
});

afterEach(() => {
  seed([]);
});

describe("selectParkedThoughts", () => {
  it("lists thoughts only, with the one pinned for today on top", () => {
    const entries = [
      entry("draft", { kind: "draft" }),
      entry("note", { kind: "note", threadKey: "env:thread" }),
      entry("newest"),
      entry("pinned", { pinnedFor: "2026-11-12" }),
      entry("older"),
    ];
    expect(selectParkedThoughts(entries, "2026-11-12").map((item) => item.id)).toEqual([
      "pinned",
      "newest",
      "older",
    ]);
  });
});

describe("selectParkedChips", () => {
  it("shows two chips, then counts the rest", () => {
    const entries = ["a", "b", "c", "d", "e"].map((id) => entry(id));
    const { chips, more } = selectParkedChips(entries, "2026-11-12");
    expect(chips.map((item) => item.id)).toEqual(["a", "b"]);
    expect(more).toBe(3);
  });

  it("leaves today's pinned thought to its own line", () => {
    const { chips, more } = selectParkedChips(
      [entry("pinned", { pinnedFor: "2026-11-12" }), entry("a")],
      "2026-11-12",
    );
    expect(chips.map((item) => item.id)).toEqual(["a"]);
    expect(more).toBe(0);
  });
});

describe("selectFirstThing", () => {
  it("takes today's pinned thought, or the latest one from a day you were away", () => {
    const entries = [
      entry("monday", { pinnedFor: "2026-11-09" }),
      entry("friday", { pinnedFor: "2026-11-06" }),
      entry("tomorrow", { pinnedFor: "2026-11-13" }),
      entry("note", { kind: "note", threadKey: "env:thread", pinnedFor: "2026-11-12" }),
    ];
    expect(selectFirstThing(entries, "2026-11-12")?.id).toBe("monday");
    expect(selectFirstThing(entries, "2026-11-13")?.id).toBe("tomorrow");
    expect(selectFirstThing([entry("a")], "2026-11-12")).toBeNull();
  });

  it("leads with the later of two thoughts pinned for the same day on two devices", () => {
    const entries = [
      entry("laptop", { pinnedFor: "2026-11-12", createdAt: "2026-11-11T18:00:00.000Z" }),
      entry("phone", { pinnedFor: "2026-11-12", createdAt: "2026-11-11T21:00:00.000Z" }),
    ];
    expect(selectFirstThing(entries, "2026-11-12")?.id).toBe("phone");
    expect(selectFirstThing(entries.toReversed(), "2026-11-12")?.id).toBe("phone");
  });

  it("keeps a thought pinned for tomorrow out of today's chips", () => {
    const { chips } = selectParkedChips(
      [entry("tomorrow", { pinnedFor: "2026-11-13" }), entry("a")],
      "2026-11-12",
    );
    expect(chips.map((item) => item.id)).toEqual(["a"]);
  });

  it("names tomorrow across a month end", () => {
    expect(nextLocalDateKey(new Date(2026, 10, 30, 22, 0).getTime())).toBe("2026-12-01");
  });
});

describe("formatParkedWhen", () => {
  const clock = (iso: string) => `clock ${iso.slice(11, 16)}`;
  it("gives a clock time today and a day before that", () => {
    const now = new Date(2026, 10, 12, 18, 0).getTime();
    expect(formatParkedWhen(new Date(2026, 10, 12, 9, 0).toISOString(), now, clock)).toMatch(
      /^clock /,
    );
    expect(formatParkedWhen(new Date(2026, 10, 10, 9, 0).toISOString(), now, clock)).not.toMatch(
      /^clock /,
    );
  });

  it("keys dates by the local day", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30).getTime())).toBe("2026-01-05");
  });
});

describe("parkThought", () => {
  it("parks a trimmed thought with its project, and Undo puts it back in place", () => {
    seed([entry("older")]);
    const result = parkThought("  Try view transitions for the sidebar  ", "env:project");
    expect(result.kind).toBe("parked");
    const parked = usePromptStashStore.getState().entries[0];
    expect(parked).toMatchObject({
      prompt: "Try view transitions for the sidebar",
      kind: "thought",
      projectKey: "env:project",
    });
    const removed = removeParkedEntry("older");
    expect(usePromptStashStore.getState().entries).toHaveLength(1);
    usePromptStashStore.getState().restoreEntry(removed!.entry, removed!.index);
    expect(usePromptStashStore.getState().entries.map((item) => item.id)).toEqual([
      parked!.id,
      "older",
    ]);
  });

  it("says Parked is full instead of dropping the oldest", () => {
    seed(Array.from({ length: MAX_PARKED_THOUGHTS }, (_, index) => entry(`t${index}`)));
    expect(parkThought("One more", null)).toEqual({
      kind: "refused",
      message: PARKED_FULL_MESSAGE,
    });
    expect(usePromptStashStore.getState().entries).toHaveLength(MAX_PARKED_THOUGHTS);
  });
});

describe("firstThingSource", () => {
  it("says yesterday for a line pinned for today, else the weekday of the wrap up", () => {
    expect(firstThingSource("2026-11-12", "2026-11-12")).toBe("from yesterday's wrap up");
    // Pinned for Tuesday 10 Nov, so written on Monday 9 Nov.
    expect(firstThingSource("2026-11-10", "2026-11-12")).toBe("from Monday's wrap up");
  });
});

describe("parkedFooterLines", () => {
  it("says where the list is kept, and counts only what is really waiting or kept here", () => {
    expect(parkedFooterLines({ waiting: 0, keptHere: 0 }, [])).toEqual([
      "Kept in this browser for now.",
    ]);
    expect(parkedFooterLines({ waiting: 0, keptHere: 0 }, ["Studio Mac"])).toEqual([
      "Saved on Studio Mac, so your other devices see it too.",
    ]);
    expect(parkedFooterLines({ waiting: 0, keptHere: 0 }, ["Studio Mac", "Laptop"])).toEqual([
      "Saved on your environments, so your other devices see it too.",
    ]);
    expect(parkedFooterLines({ waiting: 3, keptHere: 1 }, ["Studio Mac"])).toEqual([
      "Saved on Studio Mac, so your other devices see it too.",
      "3 waiting to be saved.",
    ]);
    expect(parkedFooterLines({ waiting: 0, keptHere: 2 }, ["Studio Mac"])[1]).toBe(
      "2 kept only in this browser.",
    );
  });
});

describe("parkedLengthCount", () => {
  it("shows a count only near the limit", () => {
    expect(parkedLengthCount(10)).toBeNull();
    expect(parkedLengthCount(812)).toBe("812 / 1,000");
    expect(parkedLengthCount(1_000)).toBe("1,000 / 1,000");
  });
});
