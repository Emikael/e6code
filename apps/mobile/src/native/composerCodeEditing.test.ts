import { describe, expect, it } from "@effect/vitest";

import {
  ComposerCodeEditingHistory,
  exitComposerCodeBlock,
  normalizeComposerCodeEdit,
  pasteComposerCodeText,
  rebasePendingComposerCodeEdit,
  removeEmptyComposerCodeBlock,
} from "./composerCodeEditing";

const state = (value: string, cursor = value.length) => ({
  value,
  selection: { start: cursor, end: cursor },
});

describe("native composer code edits", () => {
  it("turns the third typed backtick into an empty fenced block with the caret inside", () => {
    expect(normalizeComposerCodeEdit(state("``"), state("```"))).toEqual(state("```\n\n```", 4));
  });

  it("creates a block on an otherwise empty line while preserving surrounding source", () => {
    expect(
      normalizeComposerCodeEdit(state("before\n``\nafter", 9), state("before\n```\nafter", 10)),
    ).toEqual(state("before\n```\n\n```\nafter", 11));
  });

  it("keeps pasted, unfinished and IME source verbatim", () => {
    for (const value of ["```", "```ts\nconst n = 1", "~~~sh\necho hi\n~~~"]) {
      const pasted = state(value);
      expect(normalizeComposerCodeEdit(state(""), pasted)).toEqual(pasted);
    }
    expect(normalizeComposerCodeEdit(state("``"), state("```"), true)).toEqual(state("```"));
    expect(normalizeComposerCodeEdit(state("inline ``"), state("inline ```"))).toEqual(
      state("inline ```"),
    );
  });

  it("edits the body of an unfinished opening fence without rewriting its language", () => {
    expect(normalizeComposerCodeEdit(state("```ts"), state("```tsx"))).toEqual(state("```ts\nx"));
    expect(normalizeComposerCodeEdit(state("```ts"), state("```ts\n"))).toEqual(state("```ts\n"));
  });

  it("keeps a large fenced paste verbatim and respects the source input limit", () => {
    const code = "```typescript\n" + "😀 @file $skill\n".repeat(3000);
    const before = { value: "before old after", selection: { start: 7, end: 10 } };
    expect(pasteComposerCodeText(before, code, 120_000)).toEqual(
      state(`before ${code} after`, 7 + code.length),
    );
    expect(pasteComposerCodeText(before, code, 100)).toBeNull();
    expect(pasteComposerCodeText(before, "plain paste", 120_000)).toBeNull();
  });

  it("keeps Enter and Shift-Enter within code until the third trailing newline exits", () => {
    expect(
      normalizeComposerCodeEdit(state("```ts\na\n```", 7), state("```ts\na\n\n```", 8)),
    ).toEqual(state("```ts\na\n\n```", 8));
    expect(
      normalizeComposerCodeEdit(state("```ts\na\n\n\n```", 9), state("```ts\na\n\n\n\n```", 10)),
    ).toEqual(state("```ts\na\n```\n", 12));
  });
});

describe("native code boundary actions and source history", () => {
  it("exits closed or unfinished code into the next paragraph without changing language or content", () => {
    expect(exitComposerCodeBlock(state("```ts\n😀\n```", 8))).toEqual(
      state("```ts\n😀\n```\n", 13),
    );
    expect(exitComposerCodeBlock(state("~~~sh\necho hi"))).toEqual(state("~~~sh\necho hi\n~~~\n"));
    expect(exitComposerCodeBlock(state("```ts\r\na\r\n```\r\nafter", 8))).toEqual(
      state("```ts\r\na\r\n```\r\nafter", 15),
    );
  });

  it("returns an empty code block to an editable paragraph while preserving adjacent text", () => {
    expect(removeEmptyComposerCodeBlock(state("before\n```\n\n```\nafter", 11))).toEqual(
      state("before\n\nafter", 7),
    );
    expect(removeEmptyComposerCodeBlock(state("```\ntext\n```", 4))).toEqual(
      state("```\ntext\n```", 4),
    );
  });

  it("undoes creation atomically, redoes source fences, and clears redo on a new edit", () => {
    const previous = state("``");
    const history = new ComposerCodeEditingHistory(previous);
    const block = normalizeComposerCodeEdit(previous, state("```"));
    history.record(block);
    expect(history.action("undo", block)).toEqual(previous);
    expect(history.action("redo", previous)).toEqual(block);
    expect(history.action("undo", block)).toEqual(previous);
    history.record(state("paragraph"));
    expect(history.action("redo", history.current)).toEqual(state("paragraph"));
  });

  it("keeps paste and clipboard source intact through undo, redo and empty-block removal", () => {
    const initial = state("plain");
    const pasted = state("plain\n```ts\n$skill @src/file\n```");
    const history = new ComposerCodeEditingHistory(initial);
    history.record(pasted);
    expect(history.action("undo", pasted)).toEqual(initial);
    expect(history.action("redo", initial)).toEqual(pasted);
    history.record(state("```\n\n```", 4));
    expect(history.action("removeEmpty", history.current)).toEqual(state(""));
    expect(history.action("undo", history.current)).toEqual(state("```\n\n```", 4));
  });
});

describe("native fence conversion revision races", () => {
  it("creates code when Android reports the pre-edit caret before its final selection event", () => {
    expect(normalizeComposerCodeEdit(state("``"), state("```", 2))).toEqual(state("```\n\n```", 4));
  });

  it("keeps the converted block through a delayed native selection echo and rapid typing", () => {
    const raw = state("```");
    const block = state("```\n\n```", 4);
    expect(rebasePendingComposerCodeEdit(raw, block, raw)).toEqual(block);
    const first = rebasePendingComposerCodeEdit(raw, block, state("```a"));
    expect(first).toEqual(state("```\na\n```", 5));
    expect(rebasePendingComposerCodeEdit(state("```a"), first!, state("```ab"))).toEqual(
      state("```\nab\n```", 6),
    );
    expect(rebasePendingComposerCodeEdit(raw, block, state("``"))).toEqual(state(""));
  });
});

it("keeps Shift-Enter as a code newline even after two trailing blank lines", () => {
  const before = state("```\na\n\n\n```", 7);
  const after = state("```\na\n\n\n\n```", 8);
  expect(normalizeComposerCodeEdit(before, after, false, true)).toEqual(after);
});
