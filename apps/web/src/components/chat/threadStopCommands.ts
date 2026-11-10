/**
 * The stops the open chat can make right now, published so the command palette
 * can offer them under the same `thread.stop` and `thread.stopSubagent`
 * shortcuts the chat answers. The chat republishes whenever what it can stop
 * changes and withdraws on unmount, so an entry never outlives its button.
 */
import { create } from "zustand";

export interface ThreadStopSubagent {
  readonly id: string;
  readonly title: string;
  readonly stop: () => void;
}

export interface ThreadStopCommands {
  /** Which chat published it, so an unmounting chat only clears its own. */
  readonly owner: string;
  /** Interrupts the running turn; null while no turn can be stopped. */
  readonly stopTurn: (() => void) | null;
  /** Running subagents the provider can stop one at a time. */
  readonly subagents: ReadonlyArray<ThreadStopSubagent>;
}

interface ThreadStopCommandsState {
  readonly commands: ThreadStopCommands | null;
  readonly publish: (commands: ThreadStopCommands) => void;
  readonly withdraw: (owner: string) => void;
}

export const useThreadStopCommandsStore = create<ThreadStopCommandsState>((set) => ({
  commands: null,
  publish: (commands) => set({ commands }),
  withdraw: (owner) =>
    set((state) => (state.commands?.owner === owner ? { commands: null } : state)),
}));
