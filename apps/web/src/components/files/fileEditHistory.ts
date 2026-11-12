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
  /** The file on disk changed to something the reader did not write: the agent's version. */
  readonly conflict: string | null;
}

export const EMPTY_FILE_EDIT_HISTORY: FileEditHistory = {
  original: null,
  undoTo: null,
  editing: false,
  saved: null,
  showSaved: false,
  conflict: null,
};

export type FileEditEvent =
  /** The reader typed: `before` is the file as it was before this change. */
  | { readonly type: "edit"; readonly before: string }
  /** A save landed. `restore` marks one written by Undo, Revert or Keep mine. */
  | { readonly type: "saved"; readonly contents: string; readonly restore: boolean }
  /** Revert my edits, Take the agent's version, or a new turn: forget the reader's edits. */
  | { readonly type: "reset" }
  /** The file was read from disk again. */
  | { readonly type: "read"; readonly contents: string }
  | { readonly type: "keep-mine" };

export function reduceFileEditHistory(
  state: FileEditHistory,
  event: FileEditEvent,
): FileEditHistory {
  switch (event.type) {
    case "edit":
      if (state.editing) return state.showSaved ? { ...state, showSaved: false } : state;
      return {
        ...state,
        original: state.original ?? event.before,
        undoTo: event.before,
        editing: true,
        showSaved: false,
      };
    case "saved":
      if (event.restore) {
        // The file is back where the reader asked; nothing of theirs is waiting to be undone.
        const backToOriginal = event.contents === state.original;
        return backToOriginal
          ? EMPTY_FILE_EDIT_HISTORY
          : { ...state, undoTo: null, editing: false, saved: event.contents, showSaved: false };
      }
      return { ...state, editing: false, saved: event.contents, showSaved: true };
    case "reset":
      return EMPTY_FILE_EDIT_HISTORY;
    case "read":
      // Only a file the reader has edited can be overwritten under them, and only by contents
      // they did not write. A read that matches their save is their own edit coming back.
      if (state.saved === null || state.editing || event.contents === state.saved) {
        return state.conflict === null ? state : { ...state, conflict: null };
      }
      if (event.contents === state.original || event.contents === state.undoTo) return state;
      return { ...state, conflict: event.contents, showSaved: false };
    case "keep-mine":
      return { ...state, conflict: null };
  }
}

/** Undo is offered while the last saved edit is the reader's own and has somewhere to go back to. */
export function canUndoFileEdit(state: FileEditHistory): boolean {
  return state.showSaved && state.undoTo !== null;
}

/** "Revert my edits" stays in More until the next turn starts. */
export function canRevertFileEdits(state: FileEditHistory, current: string | null): boolean {
  return state.original !== null && current !== null && current !== state.original;
}
