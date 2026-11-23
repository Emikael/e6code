import { describe, expect, it } from "vite-plus/test";

import type { MetricOutcome } from "../report.ts";
import { threadSwitchMetrics, type Switch, type SwitchSource } from "./threadSwitchRows.ts";

const sw = (
  visit: Switch["visit"],
  rowsStatus: string | null,
  rowsMs: number | null,
  liveMs: number | null,
  threadId = "t",
): Switch => ({ threadId, visit, rowsStatus, rowsMs, liveMs });

const cached: SwitchSource = {
  threadId: "t",
  resumedFromCache: true,
  snapshotSent: false,
  httpSnapshot: false,
};
const snapshotted: SwitchSource = { ...cached, resumedFromCache: false, snapshotSent: true };

const row = (metrics: ReadonlyArray<MetricOutcome>, id: MetricOutcome["id"]) => {
  const found = metrics.find((metric) => metric.id === id);
  if (found === undefined) throw new Error(`no ${id} row`);
  return found;
};

describe("threadSwitchMetrics", () => {
  // Revisits land on threads the client still holds live: rows and live marks coincide.
  const revisits = Array.from({ length: 4 }, () => sw("revisit", "live", 20, 20));
  const firstVisits = [
    sw("first", "synchronizing", 150, 180),
    sw("first", "synchronizing", 160, 900),
  ];

  it("times live-synced from after-reload switches whose rows were not live yet", () => {
    const afterReload = [
      sw("afterReload", "synchronizing", 90, 110),
      sw("afterReload", "synchronizing", 80, 130),
      sw("afterReload", "cached", 70, 300),
    ];
    const live = row(
      threadSwitchMetrics({
        switches: [...firstVisits, ...revisits, ...afterReload],
        afterReloadSources: [cached, cached, snapshotted],
        reloads: 1,
      }),
      "web.threadSwitch.firstRows.live",
    );
    expect(live).toMatchObject({
      kind: "measured",
      statistic: "p95",
      value: 300,
      samples: 3,
      source: expect.stringContaining("after a reload"),
      points: [
        { label: "afterReload.1", atMs: null, value: 110 },
        { label: "afterReload.2", atMs: null, value: 130 },
        { label: "afterReload.3", atMs: null, value: 300 },
      ],
    });
    expect(live.flags).toEqual(
      expect.arrayContaining([
        "afterReloadCounted:3/3",
        "liveAfterRows:3/3",
        "fromCacheByWire:2/3",
        "firstVisitSamplesInRaw:2",
        "revisitSamplesInRaw:4",
      ]),
    );
  });

  it("leaves out after-reload switches that were already live or never marked live", () => {
    const afterReload = [
      sw("afterReload", "synchronizing", 90, 110),
      sw("afterReload", "synchronizing", 85, null),
      sw("afterReload", "live", 40, 40),
    ];
    const live = row(
      threadSwitchMetrics({
        switches: [...revisits, ...afterReload],
        afterReloadSources: [cached, cached, cached],
        reloads: 1,
      }),
      "web.threadSwitch.firstRows.live",
    );
    expect(live).toMatchObject({ kind: "measured", value: 110, samples: 1 });
    expect(live.flags).toEqual(
      expect.arrayContaining(["afterReloadCounted:1/3", "liveMarkMissing:1", "rowsAlreadyLive:1"]),
    );
  });

  it("does not fall back to revisits when no after-reload switch went live", () => {
    const live = row(
      threadSwitchMetrics({
        switches: [...revisits, sw("afterReload", "synchronizing", 90, null)],
        afterReloadSources: [cached],
        reloads: 1,
      }),
      "web.threadSwitch.firstRows.live",
    );
    expect(live).toMatchObject({
      kind: "notMeasured",
      reason: expect.stringContaining("after a reload"),
    });
    expect(live.flags).toEqual(expect.arrayContaining(["liveMarkMissing:1"]));
  });

  it("times first rows from cache only on switches the wire proves were cached", () => {
    const cache = row(
      threadSwitchMetrics({
        switches: [
          ...revisits,
          sw("afterReload", "synchronizing", 90, 110),
          sw("afterReload", "synchronizing", 400, 500),
        ],
        afterReloadSources: [cached, snapshotted],
        reloads: 1,
      }),
      "web.threadSwitch.firstRows.cache",
    );
    expect(cache).toMatchObject({ kind: "measured", value: 90, samples: 1 });
    expect(cache.flags).toEqual(expect.arrayContaining(["provenFromCacheByWire:1/2"]));
  });
});
