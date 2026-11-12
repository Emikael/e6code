import { describe, expect, it } from "vite-plus/test";

import {
  canRevertFileEdits,
  canUndoFileEdit,
  EMPTY_FILE_EDIT_HISTORY,
  type FileEditEvent,
  reduceFileEditHistory,
} from "./fileEditHistory";

const run = (events: ReadonlyArray<FileEditEvent>) =>
  events.reduce(reduceFileEditHistory, EMPTY_FILE_EDIT_HISTORY);

describe("the reader's edits to a file", () => {
  it("says nothing until the reader edits, then that the edit saved, with Undo", () => {
    expect(canUndoFileEdit(EMPTY_FILE_EDIT_HISTORY)).toBe(false);
    const typing = run([{ type: "edit", before: "agent" }]);
    expect(typing.showSaved).toBe(false);
    const saved = run([
      { type: "edit", before: "agent" },
      { type: "edit", before: "agent!" },
      { type: "saved", contents: "agent!!", restore: false },
    ]);
    expect(saved.showSaved).toBe(true);
    expect(canUndoFileEdit(saved)).toBe(true);
    expect(saved.undoTo).toBe("agent");
    expect(canRevertFileEdits(saved, "agent!!")).toBe(true);
  });

  it("undoes the last saved edit and reverts to the file before the first", () => {
    const twoEdits = run([
      { type: "edit", before: "v0" },
      { type: "saved", contents: "v1", restore: false },
      { type: "edit", before: "v1" },
      { type: "saved", contents: "v2", restore: false },
    ]);
    expect(twoEdits).toMatchObject({ original: "v0", undoTo: "v1" });
    const undone = reduceFileEditHistory(twoEdits, {
      type: "saved",
      contents: "v1",
      restore: true,
    });
    expect(canUndoFileEdit(undone)).toBe(false);
    expect(canRevertFileEdits(undone, "v1")).toBe(true);
    const reverted = reduceFileEditHistory(undone, {
      type: "saved",
      contents: "v0",
      restore: true,
    });
    expect(reverted).toEqual(EMPTY_FILE_EDIT_HISTORY);
  });

  it("notices when the file on disk changes to something the reader did not write", () => {
    const saved = run([
      { type: "edit", before: "v0" },
      { type: "saved", contents: "mine", restore: false },
    ]);
    // Its own save read back, or the stale read from before it, is not a conflict.
    expect(reduceFileEditHistory(saved, { type: "read", contents: "mine" }).conflict).toBeNull();
    expect(reduceFileEditHistory(saved, { type: "read", contents: "v0" }).conflict).toBeNull();
    const conflict = reduceFileEditHistory(saved, { type: "read", contents: "theirs" });
    expect(conflict.conflict).toBe("theirs");
    expect(reduceFileEditHistory(conflict, { type: "keep-mine" }).conflict).toBeNull();
    // A file the reader never edited has nothing to lose.
    expect(
      reduceFileEditHistory(EMPTY_FILE_EDIT_HISTORY, { type: "read", contents: "theirs" }),
    ).toBe(EMPTY_FILE_EDIT_HISTORY);
  });

  it("keeps an unsaved edit and the agent's change both in view until the reader picks", () => {
    const editing = run([{ type: "edit", before: "v0" }]);
    // A read while the edit is unsaved neither raises nor clears the notice.
    expect(reduceFileEditHistory(editing, { type: "read", contents: "theirs" })).toBe(editing);
    const held = reduceFileEditHistory(editing, {
      type: "changed-underneath",
      contents: "theirs",
      mine: "mine",
    });
    expect(held.held).toBe("mine");
    expect(held.conflict).toBe("theirs");
    expect(reduceFileEditHistory(held, { type: "read", contents: "theirs" }).conflict).toBe(
      "theirs",
    );
    // Keep mine: the held save lands as the reader's own edit, with Undo.
    const keep: ReadonlyArray<FileEditEvent> = [
      { type: "keep-mine" },
      { type: "saved", contents: "mine", restore: false },
    ];
    const kept = keep.reduce(reduceFileEditHistory, held);
    expect(kept.conflict).toBeNull();
    expect(kept.held).toBeNull();
    expect(canUndoFileEdit(kept)).toBe(true);
  });
});
