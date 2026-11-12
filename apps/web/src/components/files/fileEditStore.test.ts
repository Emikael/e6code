import { describe, expect, it } from "vite-plus/test";

import { canRevertFileEdits, EMPTY_FILE_EDIT_HISTORY, type FileEditEvent } from "./fileEditHistory";
import {
  type FileEditEntry,
  fileEditHistoryForTurn,
  fileEditKey,
  heldFilePaths,
  reduceFileEditEntries,
} from "./fileEditStore";

const key = fileEditKey("thread-1", "src/a.ts");
const apply = (
  turnKey: string,
  events: ReadonlyArray<FileEditEvent>,
  start: Readonly<Record<string, FileEditEntry>> = {},
) => events.reduce((byKey, event) => reduceFileEditEntries(byKey, key, turnKey, event), start);

describe("the reader's edits, kept per thread and file", () => {
  it("keeps Undo and Revert for the file until the next turn starts", () => {
    const edited = apply("turn-1", [
      { type: "edit", before: "v0", after: "v1" },
      { type: "saved", contents: "v1", restore: false },
    ]);
    // Another file, another tab, View diff: the entry is still there for the same turn.
    const history = fileEditHistoryForTurn(edited[key], "turn-1");
    expect(history.undoTo).toBe("v0");
    expect(canRevertFileEdits(history, "v1")).toBe(true);
    expect(fileEditHistoryForTurn(edited[key], "turn-2")).toBe(EMPTY_FILE_EDIT_HISTORY);
    expect(apply("turn-2", [{ type: "reset" }], edited)).toEqual({});
  });

  it("never lets a turn drop the reader's held text, and lists the file as unsaved", () => {
    const held = apply("turn-1", [
      { type: "edit", before: "v0", after: "mine" },
      { type: "changed-underneath", contents: "theirs", mine: "mine" },
      { type: "edit", before: "mine", after: "mine, more" },
    ]);
    expect(heldFilePaths(held, "thread-1")).toEqual(new Set(["src/a.ts"]));
    expect(heldFilePaths(held, "thread-2").size).toBe(0);
    const nextTurn = fileEditHistoryForTurn(held[key], "turn-2");
    expect(nextTurn).toMatchObject({ held: "mine, more", conflict: "theirs", original: null });
    // Revert is not offered while both versions are waiting on the reader.
    expect(canRevertFileEdits(fileEditHistoryForTurn(held[key], "turn-1"), "mine, more")).toBe(
      false,
    );
    const kept = apply("turn-2", [{ type: "keep-mine" }], held);
    expect(heldFilePaths(kept, "thread-1").size).toBe(0);
  });

  it("stores nothing for a file the reader never edited", () => {
    const byKey = {};
    expect(reduceFileEditEntries(byKey, key, "turn-1", { type: "read", contents: "x" })).toBe(
      byKey,
    );
  });
});
