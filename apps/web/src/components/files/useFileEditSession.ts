import type { EnvironmentId } from "@e6tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  canRevertFileEdits,
  canUndoFileEdit,
  EMPTY_FILE_EDIT_HISTORY,
  type FileEditEvent,
  type FileEditHistory,
  reduceFileEditHistory,
} from "./fileEditHistory";
import {
  clearProjectFileQueryData,
  getOptimisticProjectFileQueryData,
  readProjectFileFromDisk,
  setProjectFileQueryData,
} from "./projectFilesQueryState";
import { useFileSaveCoordinator } from "./useFileSaveCoordinator";

export interface FileEditSession {
  /** The reader changed the file: shown at once, saved after a pause. */
  readonly edit: (contents: string) => void;
  readonly history: FileEditHistory;
  readonly canUndo: boolean;
  readonly canRevert: boolean;
  readonly undo: () => void;
  readonly revert: () => void;
  readonly keepMine: () => void;
  readonly takeTheirs: () => void;
}

/**
 * The open file's saves and the reader's edit history (see fileEditHistory.ts). The history is
 * kept per file and forgotten when the next turn starts, so Revert reaches back only to the file
 * as the last turn left it.
 */
export function useFileEditSession(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** Null while no editable file is open. */
  readonly relativePath: string | null;
  /** The file as shown, with any unsaved edit. */
  readonly contents: string | null;
  /** The file as last read from disk. */
  readonly serverContents: string | null;
  /** Changes when a turn starts. */
  readonly turnKey: string | null;
  readonly onPendingChange: (relativePath: string, pending: boolean) => void;
}): FileEditSession {
  const { environmentId, cwd, relativePath } = input;
  const key = `${relativePath ?? ""}\u0000${input.turnKey ?? ""}`;
  const [state, setState] = useState<{ key: string; history: FileEditHistory }>({
    key,
    history: EMPTY_FILE_EDIT_HISTORY,
  });
  const history = state.key === key ? state.history : EMPTY_FILE_EDIT_HISTORY;
  const dispatch = useCallback(
    (event: FileEditEvent) =>
      setState((current) => {
        const base = current.key === key ? current.history : EMPTY_FILE_EDIT_HISTORY;
        const next = reduceFileEditHistory(base, event);
        return next === base && current.key === key ? current : { key, history: next };
      }),
    [key],
  );
  // Contents written back by Undo, Revert or Keep mine, so their save is not counted as an edit.
  const restoringRef = useRef<string | null>(null);
  // What the reader's unsaved edit started from, and their last save: a file on disk that is
  // neither changed under them, and their save is held rather than written over it.
  const baseRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const contentsRef = useRef(input.contents);
  const serverContentsRef = useRef(input.serverContents);
  const editingRef = useRef(history.editing);
  // Read through a ref so `edit` stays stable across turns: the editor is built around it.
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    contentsRef.current = input.contents;
    serverContentsRef.current = input.serverContents;
    editingRef.current = history.editing;
    dispatchRef.current = dispatch;
  });
  const onConfirmed = useCallback((contents: string) => {
    const restore = restoringRef.current === contents;
    if (restore) restoringRef.current = null;
    lastSavedRef.current = contents;
    dispatchRef.current({ type: "saved", contents, restore });
  }, []);
  const check = useCallback(
    async (contents: string) => {
      if (relativePath === null) return true;
      const disk = await readProjectFileFromDisk(environmentId, cwd, relativePath);
      if (
        disk === null ||
        disk === contents ||
        disk === baseRef.current ||
        disk === lastSavedRef.current
      ) {
        return true;
      }
      dispatchRef.current({ type: "changed-underneath", contents: disk });
      return false;
    },
    [cwd, environmentId, relativePath],
  );
  const coordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange: input.onPendingChange,
    onConfirmed,
    check,
  });

  const edit = useCallback(
    (contents: string) => {
      if (relativePath === null) return;
      const before =
        getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ??
        contentsRef.current;
      if (!editingRef.current) {
        baseRef.current = serverContentsRef.current;
        editingRef.current = true;
      }
      if (before !== null) dispatchRef.current({ type: "edit", before });
      setProjectFileQueryData(environmentId, cwd, relativePath, contents);
      coordinator.change(contents);
    },
    [coordinator, cwd, environmentId, relativePath],
  );
  const write = (contents: string | null) => {
    if (relativePath === null || contents === null) return;
    restoringRef.current = contents;
    setProjectFileQueryData(environmentId, cwd, relativePath, contents);
    coordinator.change(contents);
  };

  // A read from disk that the reader did not write is the agent's: say so rather than lose either.
  useEffect(() => {
    if (input.serverContents !== null) dispatch({ type: "read", contents: input.serverContents });
  }, [dispatch, input.serverContents]);

  return {
    edit,
    history,
    canUndo: canUndoFileEdit(history),
    canRevert: canRevertFileEdits(history, input.contents),
    undo: () => write(history.undoTo),
    revert: () => write(history.original),
    keepMine: () => {
      dispatch({ type: "keep-mine" });
      // An unsaved edit was held: save it now. Otherwise put the reader's last save back.
      if (history.editing) coordinator.release();
      else write(history.saved);
    },
    takeTheirs: () => {
      if (coordinator.discard() && relativePath !== null) {
        clearProjectFileQueryData(environmentId, cwd, relativePath);
      }
      dispatch({ type: "reset" });
    },
  };
}
