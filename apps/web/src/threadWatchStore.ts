import { scopedThreadKey, scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@e6tools/contracts";
import { create } from "zustand";

import type { ThreadWatchChoice } from "./threadNotificationPolicy";

/**
 * Threads you are waiting on, keyed by `scopedThreadKey`, until their turn
 * settles. Sending a message records "sent", which follows the "Tell me when
 * my thread finishes" setting; the now bar's toggle records an explicit "on"
 * or "off" that overrides it for that thread (`isThreadWatched` decides).
 * Client-local and per window, like the rest of the return cue.
 */
interface ThreadWatchState {
  readonly watched: Readonly<Record<string, ThreadWatchChoice>>;
  /** Counts your sends; each one is a breakpoint for held notifications. */
  readonly sendSequence: number;
  /** Records a send. An explicit choice from the now bar stands. */
  readonly noteSent: (key: string) => void;
  /** The now bar's toggle: an explicit choice for this thread's turn. */
  readonly choose: (key: string, watch: boolean) => void;
  /** The turn ended: the thread is no longer waited on. */
  readonly endWatch: (key: string) => void;
}

export const useThreadWatchStore = create<ThreadWatchState>()((set) => ({
  watched: {},
  sendSequence: 0,
  noteSent: (key) =>
    set((state) => ({
      sendSequence: state.sendSequence + 1,
      watched: state.watched[key] ? state.watched : { ...state.watched, [key]: "sent" },
    })),
  choose: (key, watch) =>
    set((state) => ({ watched: { ...state.watched, [key]: watch ? "on" : "off" } })),
  endWatch: (key) =>
    set((state) => {
      if (!state.watched[key]) return state;
      const next = { ...state.watched };
      delete next[key];
      return { watched: next };
    }),
}));

/** Called on every send: a breakpoint, and a watch that follows the setting. */
export function noteThreadTurnSent(environmentId: EnvironmentId, threadId: ThreadId) {
  useThreadWatchStore.getState().noteSent(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
}
