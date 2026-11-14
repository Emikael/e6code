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
  /** When you left each thread, on this device's clock: the five-minute break test. */
  readonly lastSeenAtByKey: Readonly<Record<string, string>>;
  /**
   * The newest activity time you had seen when you left, on the server's
   * clock, so "something new" never compares two different clocks.
   */
  readonly seenActivityAtByKey: Readonly<Record<string, string>>;
  /** Set by the palette's "Where was I?"; the open thread shows its recap again. */
  readonly recapRequest: { readonly key: string; readonly nonce: number } | null;
  readonly noteSeen: (key: string, seenAt: string, seenActivityAt: string | null) => void;
  readonly requestRecap: (key: string) => void;
}

const STORAGE_NAME = "e6code:thread-recap:v1";

/** Keeps `key` last, dropping the oldest entries past the cap. */
function withEntry(
  map: Readonly<Record<string, string>>,
  key: string,
  value: string,
  order: Readonly<Record<string, string>>,
): Record<string, string> {
  const { [key]: _previous, ...rest } = map;
  const keys = Object.keys(rest);
  const kept =
    keys.length < MAX_SEEN_THREADS
      ? rest
      : Object.fromEntries(
          Object.entries(rest)
            .toSorted(([a], [b]) => Date.parse(order[b] ?? "") - Date.parse(order[a] ?? ""))
            .slice(0, MAX_SEEN_THREADS - 1),
        );
  return { ...kept, [key]: value };
}

export const useThreadRecapStore = create<ThreadRecapState>()(
  persist(
    (set) => ({
      lastSeenAtByKey: {},
      seenActivityAtByKey: {},
      recapRequest: null,
      noteSeen: (key, seenAt, seenActivityAt) =>
        set((state) => {
          const lastSeenAtByKey = withEntry(
            state.lastSeenAtByKey,
            key,
            seenAt,
            state.lastSeenAtByKey,
          );
          const seenActivityAtByKey = Object.fromEntries(
            Object.entries(
              seenActivityAt === null
                ? state.seenActivityAtByKey
                : withEntry(state.seenActivityAtByKey, key, seenActivityAt, lastSeenAtByKey),
            ).filter(([entryKey]) => entryKey in lastSeenAtByKey),
          );
          return { lastSeenAtByKey, seenActivityAtByKey };
        }),
      requestRecap: (key) =>
        set((state) => ({
          recapRequest: { key, nonce: (state.recapRequest?.nonce ?? 0) + 1 },
        })),
    }),
    {
      name: STORAGE_NAME,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        lastSeenAtByKey: state.lastSeenAtByKey,
        seenActivityAtByKey: state.seenActivityAtByKey,
      }),
    },
  ),
);

// Another tab wrote its visits: read them in, so this tab's next write keeps them.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_NAME) void useThreadRecapStore.persist.rehydrate();
  });
}
