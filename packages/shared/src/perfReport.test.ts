import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  PERF_METRIC_IDS,
  PERF_METRICS,
  PERF_REPORT_KIND,
  PerfReport,
  type PerfMetric,
} from "./perfReport.ts";

/** The metric ids of the plan's §2.3 table, one block per §3.1 budget row. */
const BUDGET_TABLE_METRIC_IDS = [
  "desktop.coldStart.firstThemedPaint",
  "desktop.coldStart.interactiveFromCache",
  "desktop.coldStart.live",
  "web.firstPaint.local",
  "web.interactive.remote.cold",
  "web.interactive.remote.warm",
  "web.threadSwitch.firstRows.cache",
  "web.threadSwitch.firstRows.live",
  "web.input.keystrokeToPaint.p95",
  "web.input.longTaskMax.streaming",
  "web.timeline.scroll.framesWithinBudget",
  "web.timeline.scroll.longTaskMax",
  "memory.renderer.heapAfterSoak",
  "memory.server.rssAfterSoak",
  "memory.growth",
  "server.eventLoop.p99.streaming",
  "server.commandAck.p95",
  "ws.liveFrame.maxBytes",
  "ws.liveEvent.p95Bytes",
  "ws.streaming.wireBytesPerSecond",
  "bundle.entryPlusChat.brotliBytes",
  "bundle.otherRoute.incrementalBrotliBytes",
  "bundle.bootScriptEvaluationMs",
  "design.idleAnimationFrames",
];

const metricSlots = (): Array<PerfMetric> =>
  PERF_METRICS.map(({ id, budgetRow }): PerfMetric => {
    if (id === "web.firstPaint.local") {
      return {
        id,
        budgetRow,
        status: "measured",
        unit: "ms",
        statistic: "p95",
        value: 212.4,
        samples: 5,
        source: "paint-timing:first-contentful-paint",
        scenario: "coldLoad",
        flags: [],
        points: [],
      };
    }
    if (id === "design.idleAnimationFrames") {
      return {
        id,
        budgetRow,
        status: "measured",
        unit: "count",
        statistic: "max",
        value: 3,
        samples: 2,
        source: "cdp-trace:PipelineReporter",
        scenario: null,
        flags: ["frameCadenceUntrusted"],
        points: [
          { label: "coldLoad.shellInteractive", atMs: null, value: 0 },
          { label: "timelineScroll.bottom", atMs: null, value: 3 },
        ],
      };
    }
    return {
      id,
      budgetRow,
      status: "notMeasured",
      reason: "scenario failed: browser exited",
      scenario: null,
      flags: [],
    };
  });

const sampleReport = (metrics: ReadonlyArray<PerfMetric> = metricSlots()) => ({
  schemaVersion: 1 as const,
  kind: PERF_REPORT_KIND,
  runId: "2026-11-21T20-00-00Z-abc123",
  startedAt: "2026-11-21T20:00:00.000Z",
  finishedAt: "2026-11-21T20:13:30.000Z",
  wallTimeMs: 810_000,
  git: { commit: "c9199495", branch: "remodel", dirty: false },
  machine: {
    platform: "darwin",
    arch: "arm64",
    cpus: 12,
    cpuModel: "Apple M3 Pro",
    memoryGb: 36,
    node: "22.23.5",
    chromium: { binary: "headless-shell", revision: "1223", version: "148.0.7778.96" },
  },
  options: {
    variant: "legacy" as const,
    motion: { requested: "full" as const, resolved: null },
    responseStreamingMode: "paragraph",
    stream: { recordingId: "cursor.streaming-prose", eventsPerSecond: 50 },
    remote: { mechanism: "tcp-proxy", rttMs: 60, mbps: 20 },
    soak: {
      minutes: 6,
      factor: 32,
      replayHoursEquivalent: 3.2,
      activeThreads: 4,
      threads: 50,
      cycleIntervalMs: 7_200,
    },
    viewport: { width: 1440, height: 900, dpr: 1 },
  },
  webBuild: { distPath: "/repo/apps/web/dist", builtByHarness: true, commit: null, stale: false },
  validity: {
    productionBuild: true,
    frameCadenceMs: { p50: 16.7 },
    frameMetricTrusted: true,
    proxySelfTest: { rttMs: 60.4, mbps: 19.6 },
    addedRpcRoundTripMs: 61,
    eventTimingObserved: true,
    notes: [],
  },
  seed: {
    durationMs: 41_000,
    threads: 50,
    longThreadTurns: 1_000,
    longThreadShape: "turns" as const,
  },
  metrics,
  scenarios: [
    {
      id: "coldLoad" as const,
      status: "passed" as const,
      error: null,
      startedAt: "2026-11-21T20:01:00.000Z",
      wallTimeMs: 95_000,
      raw: { firstPaintMs: [201, 212.4, 190] },
      screenshots: [{ point: "coldLoad.shellInteractive", path: "/tmp/shot.png" }],
    },
  ],
  processes: [
    {
      role: "server",
      scenario: "coldLoad" as const,
      pid: 4242,
      port: 51234,
      stop: { signal: "SIGTERM" as const, exitedAfterMs: 820, forced: false },
    },
  ],
});

const decode = Schema.decodeUnknownEffect(PerfReport);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(PerfReport));
const parseJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

describe("perfReport", () => {
  it("names one slot for every metric of the budget table", () => {
    expect(PERF_METRIC_IDS).toEqual(BUDGET_TABLE_METRIC_IDS);
    expect(new Set(PERF_METRICS.map((metric) => metric.budgetRow)).size).toBe(14);
  });

  it.effect("round-trips through plain JSON with the decoded and encoded forms equal", () =>
    Effect.gen(function* () {
      const report = yield* decode(sampleReport());
      const text = yield* encodeJson(report);
      // A gate that cannot import the schema reads the same shape.
      const plain = yield* parseJson(text);
      expect(plain).toEqual(report);
      expect(yield* decode(plain)).toEqual(report);
    }),
  );

  it.effect("rejects a report that leaves out or repeats a metric", () =>
    Effect.gen(function* () {
      const slots = metricSlots();
      const missing = yield* Effect.exit(decode(sampleReport(slots.slice(1))));
      expect(missing._tag).toBe("Failure");
      const repeated = yield* Effect.exit(decode(sampleReport([...slots, slots[0]!])));
      expect(repeated._tag).toBe("Failure");
    }),
  );

  it.effect("requires a reason on every metric it did not measure", () =>
    Effect.gen(function* () {
      for (const reason of [undefined, "", "   "]) {
        const metrics = metricSlots().map((metric) => {
          if (metric.id !== "desktop.coldStart.live") return metric;
          const { reason: _reason, ...rest } = metric as Extract<
            PerfMetric,
            { status: "notMeasured" }
          >;
          return reason === undefined ? rest : { ...rest, reason };
        });
        const result = yield* Effect.exit(decode(sampleReport(metrics as Array<PerfMetric>)));
        expect(result._tag, `reason '${String(reason)}'`).toBe("Failure");
      }
    }),
  );

  it.effect("accepts the free text a failed run produces", () =>
    Effect.gen(function* () {
      const base = sampleReport();
      const metrics = base.metrics.map((metric) =>
        metric.status === "notMeasured"
          ? { ...metric, reason: "scenario failed: Error: page crashed\n    at run.ts:12\n" }
          : metric,
      );
      const report = yield* decode({
        ...base,
        metrics,
        machine: { ...base.machine, cpuModel: "" },
        scenarios: [
          {
            ...base.scenarios[0]!,
            status: "failed" as const,
            error: "TimeoutError: waited 30000 ms\n    at waitForMark (browser.ts:88)\n",
          },
        ],
        validity: { ...base.validity, notes: ["", " proxy self-test skipped "] },
      });
      expect(report.machine.cpuModel).toBe("");
      expect(report.scenarios[0]?.error).toContain("\n    at waitForMark");
    }),
  );

  it.effect("carries values only: a measured row has a value and no threshold or verdict", () =>
    Effect.gen(function* () {
      const report = yield* decode(sampleReport());
      const measured = report.metrics.find((metric) => metric.id === "web.firstPaint.local");
      expect(measured).toMatchObject({ status: "measured", value: 212.4 });
      expect(Object.keys(measured!).toSorted()).toEqual(
        [
          "budgetRow",
          "flags",
          "id",
          "points",
          "samples",
          "scenario",
          "source",
          "statistic",
          "status",
          "unit",
          "value",
        ].toSorted(),
      );
      const withoutValue = sampleReport().metrics.map((metric) =>
        metric.id === "web.firstPaint.local" ? { ...metric, value: undefined } : metric,
      );
      const result = yield* Effect.exit(decode(sampleReport(withoutValue as Array<PerfMetric>)));
      expect(result._tag).toBe("Failure");
    }),
  );
});
