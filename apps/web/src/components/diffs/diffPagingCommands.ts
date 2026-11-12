import { useEffect, useLayoutEffect, useRef } from "react";
import { create } from "zustand";

/** The paging commands of the open Diff tab, for the command palette. */
export interface DiffPagingCommands {
  readonly nextChange: () => void;
  readonly nextFile: () => void;
  readonly previousFile: () => void;
}

export const useDiffPagingCommandsStore = create<{ readonly commands: DiffPagingCommands | null }>(
  () => ({ commands: null }),
);

/**
 * Offers a mounted Diff tab's paging to the command palette while `enabled`. The registered
 * object stays the same across renders and always calls the latest handlers.
 */
export function useRegisterDiffPagingCommands(
  enabled: boolean,
  handlers: { nextChange: () => void; goToFile: (delta: 1 | -1) => void },
) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const commands: DiffPagingCommands = {
      nextChange: () => latest.current.nextChange(),
      nextFile: () => latest.current.goToFile(1),
      previousFile: () => latest.current.goToFile(-1),
    };
    useDiffPagingCommandsStore.setState({ commands });
    return () => {
      if (useDiffPagingCommandsStore.getState().commands === commands) {
        useDiffPagingCommandsStore.setState({ commands: null });
      }
    };
  }, [enabled]);
}
