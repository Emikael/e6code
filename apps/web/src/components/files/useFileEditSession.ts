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
  getOptimisticProjectFileQueryData,
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
  const onConfirmed = useCallback(
    (contents: string) => {
      const restore = restoringRef.current === contents;
      if (restore) restoringRef.current = null;
      dispatch({ type: "saved", contents, restore });
    },
    [dispatch],
  );
  const coordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange: input.onPendingChange,
    onConfirmed,
  });
  const contentsRef = useRef(input.contents);
  // Read through a ref so `edit` stays stable across turns: the editor is built around it.
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    contentsRef.current = input.contents;
    dispatchRef.current = dispatch;
  });

  const edit = useCallback(
    (contents: string) => {
      if (relativePath === null) return;
      const before =
        getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ??
        contentsRef.current;
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
      write(history.saved);
    },
    takeTheirs: () => dispatch({ type: "reset" }),
  };
}
