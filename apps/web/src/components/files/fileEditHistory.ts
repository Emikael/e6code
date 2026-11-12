/**
 * What the Files tab knows about the reader's own edits to one file since the current turn
 * started. Edits save themselves after a pause; this is what makes them reversible and visible:
 * "Your edit saved" with Undo (back to before the last saved edit), "Revert my edits" (back to the
 * file as it was before the first one), and a notice when the agent writes the file too.
 */
export interface FileEditHistory {
  /** The file before the reader's first edit; null while they have not edited it. */
  readonly original: string | null;
  /** The file before the edit that saved last; Undo goes back here. */
  readonly undoTo: string | null;
  /** The edit under way has not been saved yet, and `undoTo` is where it started. */
  readonly editing: boolean;
  /** The reader's contents as last saved. */
  readonly saved: string | null;
  /** "Your edit saved" shows. */
  readonly showSaved: boolean;
  /** The reader took the agent's version; Undo brings their own text back. */
  readonly tookTheirs: boolean;
  /** The file on disk changed to something the reader did not write: the agent's version. */
  readonly conflict: string | null;
  /**
   * The reader's text whose save is held because the agent changed the file under it. Kept here,
   * not only in the editor, so leaving the file and coming back still shows it with the notice.
   */
  readonly held: string | null;
}

export const EMPTY_FILE_EDIT_HISTORY: FileEditHistory = {
  original: null,
  undoTo: null,
  editing: false,
  saved: null,
  showSaved: false,
  tookTheirs: false,
  conflict: null,
  held: null,
};

export type FileEditEvent =
  /** The reader typed: `before` is the file as it was before this change, `after` as it is now. */
  | { readonly type: "edit"; readonly before: string; readonly after?: string }
  /** A save landed. `restore` marks one written by Undo, Revert or Keep mine. */
  | { readonly type: "saved"; readonly contents: string; readonly restore: boolean }
  /** Revert my edits, Take the agent's version, or a new turn: forget the reader's edits. */
  | { readonly type: "reset" }
  /** The file was read from disk again. */
  | { readonly type: "read"; readonly contents: string }
  /**
   * A save of `mine` was held: the file on disk is now `contents`, which the reader did not write.
   */
  | { readonly type: "changed-underneath"; readonly contents: string; readonly mine: string }
  /** Keep mine: the reader's text goes over the agent's, which Undo can bring back. */
  | { readonly type: "keep-mine" }
  /** Take the agent's version: `mine` is the reader's text it replaced, which Undo brings back. */
  | { readonly type: "take-theirs"; readonly mine: string | null };

export function reduceFileEditHistory(
  state: FileEditHistory,
  event: FileEditEvent,
): FileEditHistory {
  switch (event.type) {
    case "edit":
      // Typing on while a save is held keeps the held text current.
      if (state.held !== null && event.after !== undefined && event.after !== state.held) {
        return { ...state, held: event.after, showSaved: false };
      }
      if (state.editing) return state.showSaved ? { ...state, showSaved: false } : state;
      return {
        ...state,
        original: state.original ?? event.before,
        undoTo: event.before,
        editing: true,
        showSaved: false,
        tookTheirs: false,
      };
    case "saved":
      if (event.restore) {
        // The file is back where the reader asked; nothing of theirs is waiting to be undone.
        const backToOriginal = event.contents === state.original;
        return backToOriginal
          ? EMPTY_FILE_EDIT_HISTORY
          : {
              ...state,
              undoTo: null,
              editing: false,
              saved: event.contents,
              showSaved: false,
              tookTheirs: false,
              // Written by the reader's own choice, over whatever was on disk.
              conflict: null,
              held: null,
            };
      }
      return {
        ...state,
        editing: false,
        saved: event.contents,
        showSaved: true,
        tookTheirs: false,
        held: null,
      };
    case "reset":
      return EMPTY_FILE_EDIT_HISTORY;
    case "read":
      // An unsaved edit is guarded by the save itself (see "changed-underneath"); a read now
      // neither raises nor settles the notice.
      if (state.editing) return state;
      // Only a file the reader has edited can be overwritten under them, and only by contents
      // they did not write. A read that matches their save is their own edit coming back.
      if (state.saved === null || event.contents === state.saved) {
        return state.conflict === null ? state : { ...state, conflict: null };
      }
      if (event.contents === state.original || event.contents === state.undoTo) return state;
      return { ...state, conflict: event.contents, showSaved: false };
    case "changed-underneath":
      return { ...state, conflict: event.contents, held: event.mine, showSaved: false };
    case "keep-mine":
      // The save that follows is the reader's own; Undo goes back to the agent's version only.
      return {
        ...state,
        undoTo: state.conflict ?? state.undoTo,
        editing: true,
        tookTheirs: false,
        conflict: null,
        held: null,
      };
    case "take-theirs":
      if (event.mine === null || state.conflict === null) return EMPTY_FILE_EDIT_HISTORY;
      return {
        ...state,
        undoTo: event.mine,
        editing: false,
        saved: state.conflict,
        showSaved: true,
        tookTheirs: true,
        conflict: null,
        held: null,
      };
  }
}

/**
 * Undo is offered while the last saved edit is the reader's own and has somewhere to go back to,
 * and while a save is held: a stray keystroke stays one click to reverse even after the agent
 * changed the file under it.
 */
export function canUndoFileEdit(state: FileEditHistory): boolean {
  return (state.showSaved || state.held !== null) && state.undoTo !== null;
}

/**
 * "Revert my edits" stays in More until the next turn starts. Not during a conflict: it would
 * write the original over the agent's version, which Take the agent's version already settles.
 */
export function canRevertFileEdits(state: FileEditHistory, current: string | null): boolean {
  return (
    state.conflict === null &&
    state.original !== null &&
    current !== null &&
    current !== state.original
  );
}
