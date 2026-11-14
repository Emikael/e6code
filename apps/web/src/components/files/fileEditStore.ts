import { create } from "zustand";

import { isElectron } from "~/env";

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
 * View diff; only the next turn retires them. Held text stays in memory only: it may hold
 * secrets, so it is never persisted, and a reload warns while any is held instead.
 */
interface FileEditStoreState {
  readonly byFileKey: Readonly<Record<string, FileEditEntry>>;
  readonly dispatch: (fileKey: string, turnKey: string | null, event: FileEditEvent) => void;
  /** A turn started: entries of earlier turns that hold nothing go. */
  readonly retireTurn: (threadKey: string, turnKey: string | null) => void;
  /** The files were deleted: their edits go, held text included. */
  readonly forgetFiles: (threadKey: string, relativePaths: ReadonlyArray<string>) => void;
  /** The thread was deleted. */
  readonly forgetThread: (threadKey: string) => void;
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

/** Entries left after dropping those `drop` picks; the same object when none goes. */
export function pruneFileEditEntries(
  byFileKey: Readonly<Record<string, FileEditEntry>>,
  drop: (fileKey: string, entry: FileEditEntry) => boolean,
): Readonly<Record<string, FileEditEntry>> {
  let next: Record<string, FileEditEntry> | null = null;
  for (const [fileKey, entry] of Object.entries(byFileKey)) {
    if (!drop(fileKey, entry)) continue;
    next ??= { ...byFileKey };
    delete next[fileKey];
  }
  return next ?? byFileKey;
}

/** An entry of an earlier turn that holds no text: the turn forgot its Undo and Revert. */
export function isRetiredFileEdit(
  fileKey: string,
  entry: FileEditEntry,
  threadKey: string,
  turnKey: string | null,
): boolean {
  return (
    fileKey.startsWith(fileEditKey(threadKey, "")) &&
    entry.turnKey !== turnKey &&
    entry.history.held === null
  );
}

export const useFileEditStore = create<FileEditStoreState>((set) => {
  const prune = (drop: (fileKey: string, entry: FileEditEntry) => boolean) =>
    set((state) => {
      const byFileKey = pruneFileEditEntries(state.byFileKey, drop);
      return byFileKey === state.byFileKey ? state : { byFileKey };
    });
  return {
    byFileKey: {},
    dispatch: (fileKey, turnKey, event) =>
      set((state) => {
        const byFileKey = reduceFileEditEntries(state.byFileKey, fileKey, turnKey, event);
        return byFileKey === state.byFileKey ? state : { byFileKey };
      }),
    retireTurn: (threadKey, turnKey) =>
      prune((fileKey, entry) => isRetiredFileEdit(fileKey, entry, threadKey, turnKey)),
    forgetFiles: (threadKey, relativePaths) => {
      if (relativePaths.length === 0) return;
      const keys = new Set(relativePaths.map((path) => fileEditKey(threadKey, path)));
      prune((fileKey) => keys.has(fileKey));
    },
    forgetThread: (threadKey) => {
      const prefix = fileEditKey(threadKey, "");
      prune((fileKey) => fileKey.startsWith(prefix));
    },
  };
});

export function hasHeldFileEdit(byFileKey: Readonly<Record<string, FileEditEntry>>): boolean {
  return Object.values(byFileKey).some((entry) => entry.history.held !== null);
}

// A reload would lose held text silently, so the browser asks first while any is held. Not in
// the desktop app: Electron cancels the unload without asking, which would block quitting.
function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
}
if (typeof window !== "undefined" && !isElectron) {
  let warning = false;
  useFileEditStore.subscribe((state) => {
    const held = hasHeldFileEdit(state.byFileKey);
    if (held === warning) return;
    warning = held;
    if (held) window.addEventListener("beforeunload", warnBeforeUnload);
    else window.removeEventListener("beforeunload", warnBeforeUnload);
  });
}

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
