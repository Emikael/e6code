import { scopedThreadKey, scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@e6tools/contracts";
import { create } from "zustand";

import { getClientSettings } from "./hooks/useSettings";

/**
 * Threads you are waiting on, keyed by `scopedThreadKey`. Sending a message
 * watches the thread until that turn settles; the now bar toggles it per
 * thread. Client-local and per window, like the rest of the return cue.
 */
interface ThreadWatchState {
  readonly watched: Readonly<Record<string, true>>;
  /** Counts your sends; each one is a breakpoint for held notifications. */
  readonly sendSequence: number;
  /** Records a send; `watch` follows the "Tell me when my thread finishes" setting. */
  readonly noteSent: (key: string, watch: boolean) => void;
  readonly setWatched: (key: string, watched: boolean) => void;
}

export const useThreadWatchStore = create<ThreadWatchState>()((set) => ({
  watched: {},
  sendSequence: 0,
  noteSent: (key, watch) =>
    set((state) => ({
      sendSequence: state.sendSequence + 1,
      watched: watch ? { ...state.watched, [key]: true } : state.watched,
    })),
  setWatched: (key, watched) =>
    set((state) => {
      if (Boolean(state.watched[key]) === watched) return state;
      const next = { ...state.watched };
      if (watched) next[key] = true;
      else delete next[key];
      return { watched: next };
    }),
}));

/** Called on every send: a breakpoint, and a watch when the setting asks for one. */
export function noteThreadTurnSent(environmentId: EnvironmentId, threadId: ThreadId) {
  useThreadWatchStore
    .getState()
    .noteSent(
      scopedThreadKey(scopeThreadRef(environmentId, threadId)),
      getClientSettings().notifyWatchedThreads,
    );
}
