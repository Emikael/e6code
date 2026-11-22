import { PERF_METRIC_IDS, PerfReport, type PerfMetric } from "@e6tools/shared/perfReport";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { assembleMetrics, buildReport, encodeReport, type ScenarioRecord } from "./report.ts";

const decodeReport = Schema.decodeUnknownSync(PerfReport);

const notRun = (id: ScenarioRecord["id"]): ScenarioRecord => ({
  id,
  status: "skipped",
  error: null,
  startedAt: null,
  wallTimeMs: null,
  raw: { reason: "not selected" },
  screenshots: [],
  metrics: [],
  idlePoints: [],
});

const byId = (metrics: ReadonlyArray<PerfMetric>) =>
  new Map(metrics.map((metric) => [metric.id, metric]));

const reportFor = (scenarios: ReadonlyArray<ScenarioRecord>, frameMetricTrusted = true) =>
  buildReport({
    runId: "run-1",
    startedAt: "2026-11-21T00:00:00.000Z",
    finishedAt: "2026-11-21T00:01:00.000Z",
    wallTimeMs: 60_000,
    git: { commit: "abc", branch: "remodel", dirty: false },
    machine: {
      platform: "darwin",
      arch: "arm64",
      cpus: 10,
      cpuModel: "Apple M",
      memoryGb: 32,
      node: "v22.23.5",
      chromium: { binary: "headless-shell", revision: "1223", version: "148.0.7778.96" },
    },
    options: {
      variant: "legacy",
      motion: { requested: "full", resolved: null },
      responseStreamingMode: "paragraph",
      stream: { recordingId: "cursor.streaming-prose", eventsPerSecond: 50 },
      remote: { mechanism: "tcp-proxy", rttMs: 60, mbps: 20 },
      soak: { minutes: 6, factor: 32, replayHoursEquivalent: 3.2, activeThreads: 4, threads: 50 },
      viewport: { width: 1440, height: 900, dpr: 1 },
    },
    webBuild: {
      distPath: "/repo/apps/web/dist",
      builtByHarness: false,
      commit: null,
      stale: false,
    },
    validity: {
      productionBuild: true,
      frameCadenceMs: { p50: 16.7 },
      frameMetricTrusted,
      proxySelfTest: null,
      addedRpcRoundTripMs: null,
      eventTimingObserved: false,
      notes: [],
    },
    seed: { durationMs: 1_000, threads: 50, longThreadTurns: 20, longThreadShape: "turns" },
    scenarios,
    processes: [],
  });

describe("assembleMetrics", () => {
  it("fills every slot when nothing ran, keeping the fixed reasons", () => {
    const metrics = byId(
      assembleMetrics(
        (["coldLoad", "threadSwitch", "streamingInput", "timelineScroll", "soak"] as const).map(
          notRun,
        ),
        { frameMetricTrusted: true },
      ),
    );
    expect([...metrics.keys()].toSorted()).toEqual([...PERF_METRIC_IDS].toSorted());
    expect(metrics.get("web.firstPaint.local")).toMatchObject({
      status: "notMeasured",
      reason: "scenario not run",
      scenario: "coldLoad",
    });
    expect(metrics.get("desktop.coldStart.live")).toMatchObject({
      status: "notMeasured",
      reason: expect.stringContaining("desktop-only"),
    });
    expect(metrics.get("bundle.otherRoute.incrementalBrotliBytes")).toMatchObject({
      status: "notMeasured",
      reason: expect.stringContaining("ENG-145"),
    });
  });

  it("reports a failed scenario's rows with its error and merges idle points from the rest", () => {
    const metrics = byId(
      assembleMetrics(
        [
          {
            ...notRun("coldLoad"),
            status: "passed",
            metrics: [
              {
                kind: "measured",
                id: "web.firstPaint.local",
                unit: "ms",
                statistic: "p95",
                value: 212.4,
                samples: 5,
                source: "paint-timing:first-contentful-paint",
              },
            ],
            idlePoints: [{ label: "coldLoad.shellInteractive", value: 0 }],
          },
          { ...notRun("threadSwitch"), status: "failed", error: "browser exited" },
        ],
        { frameMetricTrusted: true },
      ),
    );
    expect(metrics.get("web.firstPaint.local")).toMatchObject({
      status: "measured",
      value: 212.4,
      scenario: "coldLoad",
      flags: [],
      points: [],
    });
    expect(metrics.get("web.threadSwitch.firstRows.cache")).toMatchObject({
      status: "notMeasured",
      reason: "scenario failed: browser exited",
    });
    expect(metrics.get("design.idleAnimationFrames")).toMatchObject({
      status: "measured",
      statistic: "max",
      value: 0,
      samples: 1,
      scenario: null,
      points: [{ label: "coldLoad.shellInteractive", atMs: null, value: 0 }],
    });
  });

  it("turns a value the schema cannot hold into a not-measured row", () => {
    const metrics = byId(
      assembleMetrics(
        [
          {
            ...notRun("coldLoad"),
            status: "passed",
            metrics: [
              {
                kind: "measured",
                id: "web.firstPaint.local",
                unit: "ms",
                statistic: "p95",
                value: Number.NaN,
                samples: 0,
                source: "paint-timing:first-contentful-paint",
              },
            ],
          },
        ],
        { frameMetricTrusted: true },
      ),
    );
    expect(metrics.get("web.firstPaint.local")).toMatchObject({
      status: "notMeasured",
      reason: expect.stringContaining("not a finite value"),
    });
  });

  it("leaves out idle points whose trace held no renderer data, and flags them", () => {
    const metrics = byId(
      assembleMetrics(
        [
          {
            ...notRun("coldLoad"),
            status: "passed",
            idlePoints: [{ label: "coldLoad.shellInteractive", value: null }],
          },
          {
            ...notRun("threadSwitch"),
            status: "passed",
            idlePoints: [{ label: "threadSwitch.threadLive", value: 0 }],
          },
        ],
        { frameMetricTrusted: true },
      ),
    );
    expect(metrics.get("design.idleAnimationFrames")).toMatchObject({
      status: "measured",
      value: 0,
      samples: 1,
      flags: ["idleTraceEmpty:coldLoad.shellInteractive"],
      points: [{ label: "threadSwitch.threadLive", atMs: null, value: 0 }],
    });
  });

  it("does not report idle frames when no idle trace held renderer data", () => {
    const metrics = byId(
      assembleMetrics(
        [
          {
            ...notRun("coldLoad"),
            status: "passed",
            idlePoints: [{ label: "coldLoad.shellInteractive", value: null }],
          },
        ],
        { frameMetricTrusted: true },
      ),
    );
    expect(metrics.get("design.idleAnimationFrames")).toMatchObject({
      status: "notMeasured",
      reason: expect.stringContaining("no renderer main-thread events"),
      flags: ["idleTraceEmpty:coldLoad.shellInteractive"],
    });
  });

  it("flags frame metrics when the frame cadence probe failed", () => {
    const metrics = byId(
      assembleMetrics(
        [
          {
            ...notRun("coldLoad"),
            status: "passed",
            idlePoints: [{ label: "coldLoad.shellInteractive", value: 2 }],
          },
        ],
        { frameMetricTrusted: false },
      ),
    );
    expect(metrics.get("design.idleAnimationFrames")?.flags).toEqual(["frameCadenceUntrusted"]);
    expect(metrics.get("web.timeline.scroll.framesWithinBudget")?.flags).toEqual([
      "frameCadenceUntrusted",
    ]);
  });
});

describe("encodeReport", () => {
  it("writes a report the shared schema decodes, with every scenario listed", () => {
    const report = reportFor([
      notRun("coldLoad"),
      { ...notRun("soak"), status: "failed", error: "x" },
    ]);
    const decoded = decodeReport(JSON.parse(encodeReport(report)));
    expect(decoded.scenarios.map((scenario) => scenario.id).toSorted()).toEqual([
      "coldLoad",
      "soak",
      "streamingInput",
      "threadSwitch",
      "timelineScroll",
    ]);
    expect(decoded.metrics).toHaveLength(PERF_METRIC_IDS.length);
  });

  it("throws instead of writing a report the schema rejects", () => {
    const report = { ...reportFor([]), wallTimeMs: -1 };
    expect(() => encodeReport(report)).toThrow();
  });
});
