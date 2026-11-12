import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  formatParkedWhen,
  localDateKey,
  parkThought,
  removeParkedEntry,
  selectParkedChips,
  selectParkedThoughts,
} from "./parkedThoughts";
import {
  MAX_PARKED_THOUGHTS,
  PARKED_FULL_MESSAGE,
  usePromptStashStore,
  type PromptStashEntry,
} from "./promptStashStore";

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
  usePromptStashStore.setState({ entries: [] });
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
    usePromptStashStore.setState({ entries: [entry("older")] });
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
    usePromptStashStore.setState({
      entries: Array.from({ length: MAX_PARKED_THOUGHTS }, (_, index) => entry(`t${index}`)),
    });
    expect(parkThought("One more", null)).toEqual({
      kind: "refused",
      message: PARKED_FULL_MESSAGE,
    });
    expect(usePromptStashStore.getState().entries).toHaveLength(MAX_PARKED_THOUGHTS);
  });
});
