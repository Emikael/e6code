/**
 * The thread-switch rows (plan §4.2) from the timed switches. Both budgets
 * are measured on the switches after a reload, where the switched-to thread
 * is not live yet: first visits have nothing cached, and revisits land on
 * threads the client still holds live, so their rows and live marks coincide.
 * Those two paths stay in the scenario's raw data and are counted in flags.
 *
 * @module perf-harness/scenarios/threadSwitchRows
 */
import type { MetricOutcome } from "../report.ts";
import { percentile } from "../stats.ts";

export interface Switch {
  readonly threadId: string;
  readonly visit: "first" | "revisit" | "afterReload";
  readonly rowsMs: number | null;
  readonly rowsStatus: string | null;
  readonly liveMs: number | null;
}

/** Where an after-reload switch's first rows came from, read off the wire. */
export interface SwitchSource {
  readonly threadId: string;
  /** The subscription resumed with `afterSequence`, which the client sends only for a cached thread. */
  readonly resumedFromCache: boolean;
  readonly snapshotSent: boolean;
  readonly httpSnapshot: boolean;
}

const present = <A>(values: ReadonlyArray<A | null>) =>
  values.filter((value): value is A => value !== null);

/** `status=count` pairs of the first-rows statuses, sorted by status. */
function rowsStatusSummary(entries: ReadonlyArray<Switch>): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const status = entry.rowsStatus ?? "absent";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}=${count}`)
    .join(",");
}

/**
 * `web.threadSwitch.firstRows.cache` and `.live`. `afterReloadSources[i]`
 * describes the i-th after-reload switch in `switches`.
 */
export function threadSwitchMetrics(input: {
  readonly switches: ReadonlyArray<Switch>;
  readonly afterReloadSources: ReadonlyArray<SwitchSource>;
  readonly reloads: number;
}): Array<MetricOutcome> {
  const firstVisits = input.switches.filter((entry) => entry.visit === "first");
  const revisits = input.switches.filter((entry) => entry.visit === "revisit");
  const afterReload = input.switches.filter((entry) => entry.visit === "afterReload");
  const reloadSummary = rowsStatusSummary(afterReload);
  // The client moves a thread to "synchronizing" as soon as it subscribes, before its cached
  // rows first render, so rows shown from the cache are marked rows:synchronizing (or
  // rows:cached, should a client mark them so). The wire says which ones were cached.
  const notLiveYet = (entry: Switch) =>
    entry.rowsStatus === "cached" || entry.rowsStatus === "synchronizing";
  const provenCached = (index: number) => {
    const source = input.afterReloadSources[index];
    return (
      source !== undefined &&
      source.resumedFromCache &&
      !source.snapshotSent &&
      !source.httpSnapshot
    );
  };

  const fromCache = afterReload.map((entry, index) => provenCached(index) && notLiveYet(entry));
  const cachedRows = afterReload.flatMap((entry, index) =>
    fromCache[index] && entry.rowsMs !== null ? [{ index, ms: entry.rowsMs }] : [],
  );
  const cacheFlags = [
    `afterReloadRowsStatus:${reloadSummary}`,
    `rowsCachedMarks:${afterReload.filter((entry) => entry.rowsStatus === "cached").length}`,
    `provenFromCacheByWire:${cachedRows.length}/${afterReload.length}`,
  ];

  // Live-synced: a thread that showed rows before it was live, timed to its live mark.
  const synced = afterReload.flatMap((entry, index) =>
    notLiveYet(entry) && entry.liveMs !== null
      ? [{ index, liveMs: entry.liveMs, rowsMs: entry.rowsMs }]
      : [],
  );
  const liveMarkMissing = afterReload.filter(
    (entry) => notLiveYet(entry) && entry.liveMs === null,
  ).length;
  const rowsAlreadyLive = afterReload.filter((entry) => entry.rowsStatus === "live").length;
  const liveFlags = [
    `afterReloadCounted:${synced.length}/${afterReload.length}`,
    `liveAfterRows:${synced.filter((entry) => entry.rowsMs !== null && entry.liveMs > entry.rowsMs).length}/${synced.length}`,
    `fromCacheByWire:${synced.filter((entry) => provenCached(entry.index)).length}/${synced.length}`,
    ...(liveMarkMissing > 0 ? [`liveMarkMissing:${liveMarkMissing}`] : []),
    ...(rowsAlreadyLive > 0 ? [`rowsAlreadyLive:${rowsAlreadyLive}`] : []),
    `afterReloadRowsStatus:${reloadSummary}`,
    `firstVisitSamplesInRaw:${present(firstVisits.map((entry) => entry.liveMs)).length}`,
    `revisitSamplesInRaw:${present(revisits.map((entry) => entry.liveMs)).length}`,
  ];

  return [
    cachedRows.length > 0
      ? {
          kind: "measured",
          id: "web.threadSwitch.firstRows.cache",
          unit: "ms",
          statistic: "p95",
          value:
            percentile(
              cachedRows.map((entry) => entry.ms),
              0.95,
            ) ?? Number.NaN,
          samples: cachedRows.length,
          source:
            "click event.timeStamp to the first e6:thread:rows:* mark, switching to visited threads after a reload; counted only when the thread's subscription resumed from the IndexedDB cache (afterSequence) and no snapshot arrived by WebSocket or HTTP",
          flags: cacheFlags,
          points: cachedRows.map((entry) => ({
            label: `afterReload.${entry.index + 1}`,
            atMs: null,
            value: entry.ms,
          })),
        }
      : {
          kind: "notMeasured",
          id: "web.threadSwitch.firstRows.cache",
          reason: `no switch after a reload showed rows proven to come from the cache (${reloadSummary || "none"} of ${afterReload.length} switches, ${input.reloads} reloads)`,
          flags: cacheFlags,
        },
    synced.length > 0
      ? {
          kind: "measured",
          id: "web.threadSwitch.firstRows.live",
          unit: "ms",
          statistic: "p95",
          value:
            percentile(
              synced.map((entry) => entry.liveMs),
              0.95,
            ) ?? Number.NaN,
          samples: synced.length,
          source:
            "click event.timeStamp to the e6:thread:live mark, switching after a reload to visited threads whose first rows were cached or synchronizing, not yet live; first-visit and revisit times are in raw",
          flags: liveFlags,
          points: synced.map((entry) => ({
            label: `afterReload.${entry.index + 1}`,
            atMs: null,
            value: entry.liveMs,
          })),
        }
      : {
          kind: "notMeasured",
          id: "web.threadSwitch.firstRows.live",
          reason: `no switch after a reload went from cached or synchronizing rows to live (${reloadSummary || "none"} of ${afterReload.length} switches, ${input.reloads} reloads)`,
          flags: liveFlags,
        },
  ];
}
