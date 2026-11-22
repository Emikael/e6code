/**
 * The JSON report the web performance harness writes and the performance gates
 * (E05-T06) read. It records values and where they came from, never budgets or
 * pass/fail: evaluating a report belongs to the gates.
 *
 * Every metric of the budget table has exactly one slot, either `measured` with
 * its source or `notMeasured` with the reason, so a gate can tell a missing
 * measurement from a missing row. The decoded and encoded forms are the same
 * plain JSON, with absent values written as `null`, so a gate that cannot import
 * this schema reads the file as it is.
 *
 * @module perfReport
 */
import * as Schema from "effect/Schema";

export const PERF_REPORT_KIND = "e6.web-perf-report";

/** Each metric id with the budget-table row (architecture §3.1) it reports against. */
export const PERF_METRICS = [
  {
    id: "desktop.coldStart.firstThemedPaint",
    budgetRow: "Desktop cold start to first themed paint",
  },
  {
    id: "desktop.coldStart.interactiveFromCache",
    budgetRow: "Desktop cold start to interactive from cache",
  },
  { id: "desktop.coldStart.live", budgetRow: "Desktop cold start to live (backend ready)" },
  { id: "web.firstPaint.local", budgetRow: "Web first paint, local server" },
  { id: "web.interactive.remote.cold", budgetRow: "Web interactive, remote profile" },
  { id: "web.interactive.remote.warm", budgetRow: "Web interactive, remote profile" },
  { id: "web.threadSwitch.firstRows.cache", budgetRow: "Thread switch to first rows" },
  { id: "web.threadSwitch.firstRows.live", budgetRow: "Thread switch to first rows" },
  { id: "web.input.keystrokeToPaint.p95", budgetRow: "Input latency while streaming" },
  { id: "web.input.longTaskMax.streaming", budgetRow: "Input latency while streaming" },
  { id: "web.timeline.scroll.framesWithinBudget", budgetRow: "Timeline scroll" },
  { id: "web.timeline.scroll.longTaskMax", budgetRow: "Timeline scroll" },
  { id: "memory.renderer.heapAfterSoak", budgetRow: "Memory" },
  { id: "memory.server.rssAfterSoak", budgetRow: "Memory" },
  { id: "memory.growth", budgetRow: "Memory" },
  { id: "server.eventLoop.p99.streaming", budgetRow: "Server event-loop delay" },
  { id: "server.commandAck.p95", budgetRow: "Command acknowledgement" },
  { id: "ws.liveFrame.maxBytes", budgetRow: "WebSocket payloads" },
  { id: "ws.liveEvent.p95Bytes", budgetRow: "WebSocket payloads" },
  { id: "ws.streaming.wireBytesPerSecond", budgetRow: "WebSocket payloads" },
  { id: "bundle.entryPlusChat.brotliBytes", budgetRow: "Bundle" },
  { id: "bundle.otherRoute.incrementalBrotliBytes", budgetRow: "Bundle" },
  { id: "bundle.bootScriptEvaluationMs", budgetRow: "Bundle" },
  // Not a budget-table row: the design rule "still at idle" (architecture §4.1).
  { id: "design.idleAnimationFrames", budgetRow: "Design rule: still at idle" },
] as const;

export type PerfMetricId = (typeof PERF_METRICS)[number]["id"];

export const PERF_METRIC_IDS: ReadonlyArray<PerfMetricId> = PERF_METRICS.map((metric) => metric.id);

/** Ids, labels and reasons: anything but blank. Free text from the machine or a failure is a plain string. */
const Label = Schema.String.check(Schema.isPattern(/\S/));
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const PerfMetricIdSchema = Schema.Literals(PERF_METRIC_IDS);

export const PerfScenarioId = Schema.Literals([
  "coldLoad",
  "threadSwitch",
  "streamingInput",
  "timelineScroll",
  "soak",
]);
export type PerfScenarioId = typeof PerfScenarioId.Type;

/** How `value` summarises the samples; `p95AtMost` is an upper bound read from histogram buckets. */
export const PerfStatistic = Schema.Literals([
  "p95",
  "p95AtMost",
  "max",
  "median",
  "fraction",
  "value",
  "series",
]);

export const PerfUnit = Schema.Literals([
  "ms",
  "bytes",
  "bytesPerSecond",
  "bytesPerMinute",
  "fraction",
  "count",
]);

/** One sample behind a value: a capture point (`atMs` null) or a time series entry. */
const PerfMetricPoint = Schema.Struct({
  label: Label,
  atMs: Schema.NullOr(NonNegative),
  value: Schema.Finite,
});

const MeasuredMetric = Schema.Struct({
  id: PerfMetricIdSchema,
  budgetRow: Label,
  status: Schema.Literal("measured"),
  unit: PerfUnit,
  statistic: PerfStatistic,
  value: Schema.Finite,
  samples: Schema.NullOr(Count),
  /** Where the value was read, e.g. `paint-timing:first-contentful-paint`. */
  source: Label,
  scenario: Schema.NullOr(PerfScenarioId),
  /** Caveats a reader must weigh, e.g. `bucketResolution:8-16ms` or `frameCadenceUntrusted`. */
  flags: Schema.Array(Label),
  points: Schema.Array(PerfMetricPoint),
});

const NotMeasuredMetric = Schema.Struct({
  id: PerfMetricIdSchema,
  budgetRow: Label,
  status: Schema.Literal("notMeasured"),
  reason: Label,
  scenario: Schema.NullOr(PerfScenarioId),
  flags: Schema.Array(Label),
});

export const PerfMetric = Schema.Union([MeasuredMetric, NotMeasuredMetric]);
export type PerfMetric = typeof PerfMetric.Type;

const MetricSlots = Schema.Array(PerfMetric).check(
  Schema.makeFilter((metrics) => {
    const seen = new Set<string>();
    for (const metric of metrics) {
      if (seen.has(metric.id)) return `metric '${metric.id}' appears more than once`;
      seen.add(metric.id);
    }
    const missing = PERF_METRIC_IDS.filter((id) => !seen.has(id));
    return missing.length === 0 || `missing metric slots: ${missing.join(", ")}`;
  }),
);

const NullableString = Schema.NullOr(Schema.String);

const PerfScenarioResult = Schema.Struct({
  id: PerfScenarioId,
  status: Schema.Literals(["passed", "failed", "skipped"]),
  error: NullableString,
  startedAt: NullableString,
  wallTimeMs: Schema.NullOr(NonNegative),
  /** Scenario-specific measurements behind the metric values, as plain JSON. */
  raw: Schema.Record(Schema.String, Schema.Unknown),
  screenshots: Schema.Array(Schema.Struct({ point: Label, path: Schema.String })),
});

const PerfProcess = Schema.Struct({
  role: Label,
  scenario: Schema.NullOr(PerfScenarioId),
  pid: Count,
  port: Schema.NullOr(Count),
  stop: Schema.NullOr(
    Schema.Struct({
      signal: Schema.Literals(["SIGTERM", "SIGKILL"]),
      exitedAfterMs: Schema.NullOr(NonNegative),
      forced: Schema.Boolean,
    }),
  ),
});

export const PerfReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal(PERF_REPORT_KIND),
  runId: Label,
  startedAt: Schema.String,
  finishedAt: Schema.String,
  wallTimeMs: NonNegative,
  git: Schema.Struct({
    commit: NullableString,
    branch: NullableString,
    dirty: Schema.NullOr(Schema.Boolean),
  }),
  machine: Schema.Struct({
    platform: Schema.String,
    arch: Schema.String,
    cpus: Count,
    cpuModel: Schema.String,
    memoryGb: NonNegative,
    node: Schema.String,
    chromium: Schema.Struct({
      binary: Schema.String,
      revision: NullableString,
      version: NullableString,
    }),
  }),
  options: Schema.Struct({
    variant: Schema.Literals(["legacy", "v2"]),
    motion: Schema.Struct({
      requested: Schema.Literals(["full", "reduced", "off"]),
      /** The level the page resolved, or null when no screen reports one. */
      resolved: NullableString,
    }),
    responseStreamingMode: Schema.String,
    stream: Schema.Struct({ recordingId: Schema.String, eventsPerSecond: NonNegative }),
    remote: Schema.Struct({ mechanism: Schema.String, rttMs: NonNegative, mbps: NonNegative }),
    soak: Schema.Struct({
      minutes: NonNegative,
      factor: NonNegative,
      replayHoursEquivalent: NonNegative,
      activeThreads: Count,
      threads: Count,
    }),
    viewport: Schema.Struct({ width: Count, height: Count, dpr: NonNegative }),
  }),
  webBuild: Schema.Struct({
    distPath: Schema.String,
    builtByHarness: Schema.Boolean,
    commit: NullableString,
    stale: Schema.Boolean,
  }),
  validity: Schema.Struct({
    productionBuild: Schema.Boolean,
    frameCadenceMs: Schema.Struct({ p50: Schema.NullOr(NonNegative) }),
    frameMetricTrusted: Schema.Boolean,
    proxySelfTest: Schema.NullOr(Schema.Struct({ rttMs: NonNegative, mbps: NonNegative })),
    addedRpcRoundTripMs: Schema.NullOr(Schema.Finite),
    eventTimingObserved: Schema.Boolean,
    notes: Schema.Array(Schema.String),
  }),
  seed: Schema.Struct({
    durationMs: NonNegative,
    threads: Count,
    longThreadTurns: Count,
    longThreadShape: Schema.Literals(["turns", "imported-messages"]),
  }),
  metrics: MetricSlots,
  scenarios: Schema.Array(PerfScenarioResult),
  processes: Schema.Array(PerfProcess),
});
export type PerfReport = typeof PerfReport.Type;
