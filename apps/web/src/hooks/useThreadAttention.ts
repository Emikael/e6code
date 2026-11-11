import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import {
  selectThreadAttention,
  type ThreadAttention,
} from "@e6tools/client-runtime/state/thread-attention";
import { useEffect, useMemo, useState } from "react";

import { useThreadShells } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";

/**
 * Needs you, for the web and desktop client: the shared selector over every
 * connected environment's threads, with this browser's visit times for the
 * "done and unseen" tier.
 *
 * It re-derives when thread data or visits change, and once more at the
 * selector's `nextChangeAtMs` (a snooze waking, a row turning 24 hours old).
 * It never runs on a minute clock; ages are drawn by leaf components.
 */
export function useThreadAttention(): ThreadAttention<EnvironmentThreadShell> {
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
  const { nextChangeAtMs } = attention;
  useEffect(() => {
    if (nextChangeAtMs === null) return;
    // Clamped to setTimeout's 32-bit limit; a late wake re-reads the clock.
    const delay = Math.min(Math.max(nextChangeAtMs - Date.now(), 0) + 50, 2 ** 31 - 1);
    const id = window.setTimeout(() => setClockTick((tick) => tick + 1), delay);
    return () => window.clearTimeout(id);
  }, [nextChangeAtMs]);
  return attention;
}

/** The blocked count alone, for badges and the tab title. */
export function useBlockedThreadCount(): number {
  return useThreadAttention().blockedCount;
}
