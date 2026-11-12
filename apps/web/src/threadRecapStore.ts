import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** Oldest entries go first past this many threads. */
const MAX_SEEN_THREADS = 300;

/**
 * When you last had each thread open, keyed by `scopedThreadKey`, for "Where
 * you left off". The sidebar's `threadLastVisitedAt` is stamped with a turn's
 * completion time rather than the moment you looked, so it cannot tell a
 * five-minute break from a glance away. Per device and per origin; the time
 * never leaves the device.
 */
interface ThreadRecapState {
  readonly lastSeenAtByKey: Readonly<Record<string, string>>;
  /** Set by the palette's "Where was I?"; the open thread shows its recap again. */
  readonly recapRequest: { readonly key: string; readonly nonce: number } | null;
  readonly noteSeen: (key: string, seenAt: string) => void;
  readonly requestRecap: (key: string) => void;
}

export const useThreadRecapStore = create<ThreadRecapState>()(
  persist(
    (set) => ({
      lastSeenAtByKey: {},
      recapRequest: null,
      noteSeen: (key, seenAt) =>
        set((state) => {
          const { [key]: _previous, ...rest } = state.lastSeenAtByKey;
          const keys = Object.keys(rest);
          const kept =
            keys.length < MAX_SEEN_THREADS
              ? rest
              : Object.fromEntries(
                  Object.entries(rest)
                    .toSorted(([, a], [, b]) => Date.parse(b) - Date.parse(a))
                    .slice(0, MAX_SEEN_THREADS - 1),
                );
          return { lastSeenAtByKey: { ...kept, [key]: seenAt } };
        }),
      requestRecap: (key) =>
        set((state) => ({
          recapRequest: { key, nonce: (state.recapRequest?.nonce ?? 0) + 1 },
        })),
    }),
    {
      name: "e6code:thread-recap:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ lastSeenAtByKey: state.lastSeenAtByKey }),
    },
  ),
);
