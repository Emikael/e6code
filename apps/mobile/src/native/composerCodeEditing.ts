import { collectComposerCodeBlocks } from "@e6tools/shared/composerCodeBlocks";

import type { ComposerEditorSelection } from "./E6ComposerEditor.types";

export interface ComposerSourceState {
  readonly value: string;
  readonly selection: ComposerEditorSelection;
}

export function normalizeComposerCodeEdit(
  previous: ComposerSourceState,
  next: ComposerSourceState,
  isComposing = false,
  isShiftEnter = false,
): ComposerSourceState {
  if (
    isComposing ||
    previous.selection.start !== previous.selection.end ||
    next.selection.start !== next.selection.end
  )
    return next;
  const cursor = previous.selection.start;
  const inserted = next.value.slice(cursor, cursor + next.value.length - previous.value.length);
  if (next.value !== previous.value.slice(0, cursor) + inserted + previous.value.slice(cursor))
    return next;
  const previousBlocks = collectComposerCodeBlocks(previous.value);
  const unfinishedOpening = previousBlocks.find(
    (block) => block.contentStart === cursor && !block.opening.endsWith("\n"),
  );
  if (unfinishedOpening && inserted && inserted !== "\n") {
    const nextCursor = cursor + inserted.length + 1;
    return {
      value: previous.value.slice(0, cursor) + "\n" + inserted + previous.value.slice(cursor),
      selection: { start: nextCursor, end: nextCursor },
    };
  }
  if (inserted === "`") {
    const insertedEnd = cursor + inserted.length;
    const lineStart = next.value.lastIndexOf("\n", insertedEnd - 1) + 1;
    const lineEnd = next.value.indexOf("\n", insertedEnd);
    const line = next.value.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (
      /^ {0,3}```$/.test(line) &&
      !previousBlocks.some((block) => cursor > block.start && cursor <= block.end)
    ) {
      const contentStart = insertedEnd + 1;
      return {
        value: next.value.slice(0, insertedEnd) + "\n\n```" + next.value.slice(insertedEnd),
        selection: { start: contentStart, end: contentStart },
      };
    }
  }
  if (inserted === "\n" && !isShiftEnter) {
    const block = previousBlocks.find((block) => cursor === block.contentEnd);
    if (block && previous.value.slice(block.contentStart, block.contentEnd).endsWith("\n\n")) {
      return exitComposerCodeBlock(previous, 2);
    }
  }
  return next;
}

export type ComposerCodeAction = "exit" | "removeEmpty" | "undo" | "redo";

export function pasteComposerCodeText(
  state: ComposerSourceState,
  text: string,
  maxInputChars: number,
): ComposerSourceState | null {
  if (collectComposerCodeBlocks(text).length === 0) return null;
  const value =
    state.value.slice(0, state.selection.start) + text + state.value.slice(state.selection.end);
  if (value.length > maxInputChars) return null;
  const cursor = state.selection.start + text.length;
  return { value, selection: { start: cursor, end: cursor } };
}

/** Rebase keystrokes that arrive before native applies the controlled fence conversion. */
export function rebasePendingComposerCodeEdit(
  raw: ComposerSourceState,
  target: ComposerSourceState,
  next: ComposerSourceState,
  isComposing = false,
  isShiftEnter = false,
): ComposerSourceState | null {
  if (raw.value === next.value) return target;
  if (raw.selection.start !== raw.selection.end || target.selection.start !== target.selection.end)
    return null;
  const cursor = raw.selection.start;
  const delta = next.value.length - raw.value.length;
  const start = delta < 0 ? cursor + delta : cursor;
  const inserted = delta > 0 ? next.value.slice(cursor, cursor + delta) : "";
  if (start < 0 || next.value !== raw.value.slice(0, start) + inserted + raw.value.slice(cursor))
    return null;
  if (delta < 0 && removeEmptyComposerCodeBlock(target).value !== target.value)
    return removeEmptyComposerCodeBlock(target);
  const targetStart = target.selection.start + Math.min(0, delta);
  const value =
    target.value.slice(0, targetStart) + inserted + target.value.slice(target.selection.end);
  const nextCursor = targetStart + inserted.length;
  return normalizeComposerCodeEdit(
    target,
    { value, selection: { start: nextCursor, end: nextCursor } },
    isComposing,
    isShiftEnter,
  );
}

export function exitComposerCodeBlock(
  state: ComposerSourceState,
  trimNewlines = 0,
): ComposerSourceState {
  const block = collectComposerCodeBlocks(state.value).find(
    (block) =>
      state.selection.start >= block.contentStart && state.selection.start <= block.contentEnd,
  );
  if (!block || state.selection.start !== state.selection.end) return state;
  const contentEnd = block.contentEnd - trimNewlines;
  const closing =
    block.closingStart === null
      ? `\n${block.fence}`
      : state.value.slice(block.contentEnd, block.end);
  const prefix = state.value.slice(0, contentEnd) + closing;
  const suffix = state.value.slice(block.end);
  const newline = suffix.startsWith("\r\n") ? "\r\n" : "\n";
  const value = prefix + (suffix.startsWith(newline) ? suffix : `${newline}${suffix}`);
  const cursor = prefix.length + newline.length;
  return { value, selection: { start: cursor, end: cursor } };
}

export function removeEmptyComposerCodeBlock(state: ComposerSourceState): ComposerSourceState {
  const block = collectComposerCodeBlocks(state.value).find(
    (block) =>
      state.selection.start === block.contentStart && block.contentStart === block.contentEnd,
  );
  if (!block || state.selection.start !== state.selection.end) return state;
  return {
    value: state.value.slice(0, block.start) + state.value.slice(block.end),
    selection: { start: block.start, end: block.start },
  };
}

/** Keep formatting changes in the same source undo step as the triggering keystroke. */
export class ComposerCodeEditingHistory {
  current: ComposerSourceState;
  private readonly past: ComposerSourceState[] = [];
  private readonly future: ComposerSourceState[] = [];

  constructor(state: ComposerSourceState) {
    this.current = state;
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  record(next: ComposerSourceState) {
    if (next.value !== this.current.value) {
      this.past.push(this.current);
      if (this.past.length > 100) this.past.shift();
      this.future.length = 0;
    }
    this.current = next;
    return next;
  }

  action(action: ComposerCodeAction, state: ComposerSourceState): ComposerSourceState {
    this.record(state);
    if (action === "exit") return this.record(exitComposerCodeBlock(state));
    if (action === "removeEmpty") return this.record(removeEmptyComposerCodeBlock(state));
    const from = action === "undo" ? this.past : this.future;
    const to = action === "undo" ? this.future : this.past;
    const next = from.pop();
    if (next) {
      to.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}
