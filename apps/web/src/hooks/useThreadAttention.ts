import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import {
  selectThreadAttention,
  type ThreadAttention,
} from "@e6tools/client-runtime/state/thread-attention";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import { useThreadShells } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";

const EMPTY_ATTENTION: ThreadAttention<EnvironmentThreadShell> = {
  blocked: [],
  earlier: [],
  review: [],
  blockedCount: 0,
  nextChangeAtMs: null,
};

/**
 * Needs you, for the web and desktop client, derived once for the whole app
 * by `ThreadAttentionSync` and read here through narrow selectors, so a
 * thread update costs one derivation however many surfaces show the result.
 */
const useThreadAttentionStore = create<{
  readonly attention: ThreadAttention<EnvironmentThreadShell>;
}>()(() => ({ attention: EMPTY_ATTENTION }));

/**
 * Derives Needs you from every connected environment's threads, with this
 * browser's visit times for the "done and unseen" tier. Mount once, inside
 * the app shell.
 *
 * It re-derives when thread data or visits change, and once more at the
 * selector's `nextChangeAtMs` (a snooze waking, a row turning 24 hours old).
 * It never runs on a minute clock; ages are drawn by leaf components.
 */
export function ThreadAttentionSync(): null {
  const threads = useThreadShells();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const [clockTick, setClockTick] = useState(0);
  const attention = useMemo(() => {
    void clockTick;
    return selectThreadAttention(threads, {
      now: new Date().toISOString(),
      lastVisitedAt: (key) => lastVisitedAtById[key],
    });
  }, [clockTick, lastVisitedAtById, threads]);
  useEffect(() => {
    useThreadAttentionStore.setState({ attention });
  }, [attention]);
  useEffect(() => () => useThreadAttentionStore.setState({ attention: EMPTY_ATTENTION }), []);
  const { nextChangeAtMs } = attention;
  useEffect(() => {
    if (nextChangeAtMs === null) return;
    // Clamped to setTimeout's 32-bit limit; a late wake re-reads the clock.
    const delay = Math.min(Math.max(nextChangeAtMs - Date.now(), 0) + 50, 2 ** 31 - 1);
    const id = window.setTimeout(() => setClockTick((tick) => tick + 1), delay);
    return () => window.clearTimeout(id);
  }, [nextChangeAtMs]);
  return null;
}

/** The whole result, for surfaces that list it. */
export function useThreadAttention(): ThreadAttention<EnvironmentThreadShell> {
  return useThreadAttentionStore((state) => state.attention);
}

/** The blocked count alone, for badges and the tab title. */
export function useBlockedThreadCount(): number {
  return useThreadAttentionStore((state) => state.attention.blockedCount);
}

/** The current result without subscribing, for shortcuts and commands. */
export function getThreadAttention(): ThreadAttention<EnvironmentThreadShell> {
  return useThreadAttentionStore.getState().attention;
}
