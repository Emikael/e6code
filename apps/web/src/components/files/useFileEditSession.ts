import type { EnvironmentId } from "@e6tools/contracts";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  canRevertFileEdits,
  canUndoFileEdit,
  type FileEditEvent,
  type FileEditHistory,
} from "./fileEditHistory";
import { fileEditHistoryForTurn, fileEditKey, useFileEditStore } from "./fileEditStore";
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
 * The open file's saves and the reader's edit history (see fileEditHistory.ts). The history lives
 * in fileEditStore by thread and path, so it outlasts the surface, and is forgotten when the next
 * turn starts, so Revert reaches back only to the file as the last turn left it.
 */
export function useFileEditSession(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** The thread the Files tab belongs to; the history is kept per thread and path. */
  readonly threadKey: string;
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
  const { environmentId, cwd, relativePath, turnKey } = input;
  const key = fileEditKey(input.threadKey, relativePath ?? "");
  const entry = useFileEditStore((state) => state.byFileKey[key]);
  const history = useMemo(() => fileEditHistoryForTurn(entry, turnKey), [entry, turnKey]);
  const dispatch = useCallback(
    (event: FileEditEvent) => {
      if (relativePath !== null) useFileEditStore.getState().dispatch(key, turnKey, event);
    },
    [key, relativePath, turnKey],
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
  const heldRef = useRef(history.held);
  // Read through a ref so the save coordinator and `edit` stay stable when a turn starts: the
  // editor is built around `edit`, and a rebuilt coordinator would lose a pending save.
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    contentsRef.current = input.contents;
    serverContentsRef.current = input.serverContents;
    editingRef.current = history.editing;
    heldRef.current = history.held;
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
      // Still held from an earlier visit: the reader has not picked a version yet.
      if (heldRef.current !== null) return false;
      const disk = await readProjectFileFromDisk(environmentId, cwd, relativePath);
      if (
        disk === null ||
        disk === contents ||
        disk === baseRef.current ||
        disk === lastSavedRef.current
      ) {
        return true;
      }
      dispatchRef.current({ type: "changed-underneath", contents: disk, mine: contents });
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
      if (before !== null) dispatchRef.current({ type: "edit", before, after: contents });
      setProjectFileQueryData(environmentId, cwd, relativePath, contents);
      coordinator.change(contents);
    },
    [coordinator, cwd, environmentId, relativePath],
  );
  // Undo, Revert and Keep mine are the reader's own decisions: they write without the
  // changed-on-disk check, and over a held save.
  const writeOver = (contents: string | null, restore: boolean) => {
    if (relativePath === null || contents === null) return;
    restoringRef.current = restore ? contents : null;
    setProjectFileQueryData(environmentId, cwd, relativePath, contents);
    coordinator.release(contents);
  };

  // A new turn forgets the last one's Undo and Revert; entries holding nothing more can go. No
  // turn yet may only mean the thread is still loading.
  useEffect(() => {
    if (turnKey !== null) useFileEditStore.getState().retireTurn(input.threadKey, turnKey);
  }, [input.threadKey, turnKey]);

  // A read from disk that the reader did not write is the agent's: say so rather than lose either.
  useEffect(() => {
    if (input.serverContents !== null) dispatch({ type: "read", contents: input.serverContents });
  }, [dispatch, input.serverContents]);

  // Back on a file whose edit is held: show the reader's text again, not the agent's.
  useEffect(() => {
    if (relativePath === null || heldRef.current === null) return;
    const held = heldRef.current;
    if (getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents !== held) {
      setProjectFileQueryData(environmentId, cwd, relativePath, held);
    }
  }, [cwd, environmentId, relativePath]);

  return {
    edit,
    history,
    canUndo: canUndoFileEdit(history),
    canRevert: canRevertFileEdits(history, input.contents),
    undo: () => writeOver(history.undoTo, true),
    revert: () => writeOver(history.original, true),
    keepMine: () => {
      const mine = history.held ?? history.saved;
      dispatch({ type: "keep-mine" });
      writeOver(mine, false);
    },
    takeTheirs: () => {
      const mine = history.held ?? history.saved;
      coordinator.discard();
      if (relativePath !== null) clearProjectFileQueryData(environmentId, cwd, relativePath);
      dispatch({ type: "take-theirs", mine });
    },
  };
}
