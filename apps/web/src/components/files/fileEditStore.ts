import { create } from "zustand";

import {
  EMPTY_FILE_EDIT_HISTORY,
  type FileEditEvent,
  type FileEditHistory,
  reduceFileEditHistory,
} from "./fileEditHistory";

/** One file's edit history, and the turn it belongs to. */
export interface FileEditEntry {
  readonly turnKey: string | null;
  readonly history: FileEditHistory;
}

/**
 * The reader's edits to files, by thread and path, for this window's lifetime. Kept outside the
 * Files surface so Undo, Revert and a held edit survive opening another file, switching tab or
 * View diff; only the next turn retires them.
 */
interface FileEditStoreState {
  readonly byFileKey: Readonly<Record<string, FileEditEntry>>;
  readonly dispatch: (fileKey: string, turnKey: string | null, event: FileEditEvent) => void;
}

export function fileEditKey(threadKey: string, relativePath: string): string {
  return `${threadKey}\u0000${relativePath}`;
}

/**
 * The history as the current turn sees it. A new turn forgets Undo and Revert, but never the
 * reader's held text: that stays, with its notice, until they pick a version.
 */
export function fileEditHistoryForTurn(
  entry: FileEditEntry | undefined,
  turnKey: string | null,
): FileEditHistory {
  if (entry === undefined) return EMPTY_FILE_EDIT_HISTORY;
  if (entry.turnKey === turnKey) return entry.history;
  const { held, conflict } = entry.history;
  return held === null
    ? EMPTY_FILE_EDIT_HISTORY
    : { ...EMPTY_FILE_EDIT_HISTORY, editing: true, held, conflict };
}

export function reduceFileEditEntries(
  byFileKey: Readonly<Record<string, FileEditEntry>>,
  fileKey: string,
  turnKey: string | null,
  event: FileEditEvent,
): Readonly<Record<string, FileEditEntry>> {
  const entry = byFileKey[fileKey];
  const base = fileEditHistoryForTurn(entry, turnKey);
  const history = reduceFileEditHistory(base, event);
  if (history === base && (entry === undefined || entry.turnKey === turnKey)) return byFileKey;
  if (history === EMPTY_FILE_EDIT_HISTORY) {
    if (entry === undefined) return byFileKey;
    const { [fileKey]: _removed, ...rest } = byFileKey;
    return rest;
  }
  return { ...byFileKey, [fileKey]: { turnKey, history } };
}

export const useFileEditStore = create<FileEditStoreState>((set) => ({
  byFileKey: {},
  dispatch: (fileKey, turnKey, event) =>
    set((state) => {
      const byFileKey = reduceFileEditEntries(state.byFileKey, fileKey, turnKey, event);
      return byFileKey === state.byFileKey ? state : { byFileKey };
    }),
}));

/** Paths in this thread whose edit is held, unsaved, behind the agent's change. */
export function heldFilePaths(
  byFileKey: Readonly<Record<string, FileEditEntry>>,
  threadKey: string,
): ReadonlySet<string> {
  const prefix = fileEditKey(threadKey, "");
  const paths = new Set<string>();
  for (const [key, entry] of Object.entries(byFileKey)) {
    if (key.startsWith(prefix) && entry.history.held !== null) paths.add(key.slice(prefix.length));
  }
  return paths;
}
