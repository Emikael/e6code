/**
 * Assembles the harness report: one slot per metric of the budget table,
 * filled from the scenarios that measured it, or `notMeasured` with why not.
 * The report is checked against `@e6tools/shared/perfReport` before it is
 * written, so a gate never reads a file the schema would reject.
 *
 * @module perf-harness/report
 */
import {
  PERF_METRICS,
  PerfReport,
  type PerfMetric,
  type PerfMetricId,
  type PerfScenarioId,
} from "@e6tools/shared/perfReport";
import * as Schema from "effect/Schema";

type MeasuredRow = Extract<PerfMetric, { readonly status: "measured" }>;

export type MetricOutcome =
  | {
      readonly kind: "measured";
      readonly id: PerfMetricId;
      readonly unit: MeasuredRow["unit"];
      readonly statistic: MeasuredRow["statistic"];
      readonly value: number;
      readonly samples: number | null;
      readonly source: string;
      readonly flags?: ReadonlyArray<string>;
      readonly points?: MeasuredRow["points"];
    }
  | {
      readonly kind: "notMeasured";
      readonly id: PerfMetricId;
      readonly reason: string;
      readonly flags?: ReadonlyArray<string>;
    };

export interface ScenarioRecord {
  readonly id: PerfScenarioId;
  readonly status: "passed" | "failed" | "skipped";
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly wallTimeMs: number | null;
  readonly raw: Record<string, unknown>;
  readonly screenshots: ReadonlyArray<{ readonly point: string; readonly path: string }>;
  readonly metrics: ReadonlyArray<MetricOutcome>;
  /**
   * `design.idleAnimationFrames` values, one per capture point; `null` when the
   * idle trace held no renderer main-thread events, so zero frames proves nothing.
   */
  readonly idlePoints: ReadonlyArray<{ readonly label: string; readonly value: number | null }>;
}

export const SCENARIO_IDS: ReadonlyArray<PerfScenarioId> = [
  "coldLoad",
  "threadSwitch",
  "streamingInput",
  "timelineScroll",
  "soak",
];

/** Which scenario measures each metric; the idle-frames row is merged from several. */
const OWNER: Partial<Record<PerfMetricId, PerfScenarioId>> = {
  "web.firstPaint.local": "coldLoad",
  "web.interactive.remote.cold": "coldLoad",
  "web.interactive.remote.warm": "coldLoad",
  "bundle.entryPlusChat.brotliBytes": "coldLoad",
  "bundle.bootScriptEvaluationMs": "coldLoad",
  "web.threadSwitch.firstRows.cache": "threadSwitch",
  "web.threadSwitch.firstRows.live": "threadSwitch",
  "web.input.keystrokeToPaint.p95": "streamingInput",
  "web.input.longTaskMax.streaming": "streamingInput",
  "server.eventLoop.p99.streaming": "streamingInput",
  "server.commandAck.p95": "streamingInput",
  "ws.liveFrame.maxBytes": "streamingInput",
  "ws.liveEvent.p95Bytes": "streamingInput",
  "ws.streaming.wireBytesPerSecond": "streamingInput",
  "web.timeline.scroll.framesWithinBudget": "timelineScroll",
  "web.timeline.scroll.longTaskMax": "timelineScroll",
  "memory.renderer.heapAfterSoak": "soak",
  "memory.server.rssAfterSoak": "soak",
  "memory.growth": "soak",
};

const IDLE_METRIC: PerfMetricId = "design.idleAnimationFrames";
const IDLE_OWNERS: ReadonlyArray<PerfScenarioId> = [
  "coldLoad",
  "threadSwitch",
  "streamingInput",
  "timelineScroll",
];

const DESKTOP_REASON =
  "desktop-only; source is <home>/userdata/logs/desktop-startup.ndjson (ENG-148); ENG-145 merges it";

/** Rows the web harness never measures, with the plan's reason. */
const FIXED_NOT_MEASURED: Partial<Record<PerfMetricId, string>> = {
  "desktop.coldStart.firstThemedPaint": DESKTOP_REASON,
  "desktop.coldStart.interactiveFromCache": DESKTOP_REASON,
  "desktop.coldStart.live": DESKTOP_REASON,
  "bundle.otherRoute.incrementalBrotliBytes": "per-route walk is ENG-145's manifest analysis",
};

const FRAME_METRICS: ReadonlySet<PerfMetricId> = new Set([
  "web.timeline.scroll.framesWithinBudget",
  IDLE_METRIC,
]);

const isCount = (value: number | null) => value === null || (Number.isInteger(value) && value >= 0);

function absentReason(scenario: ScenarioRecord | undefined): string {
  if (scenario?.status === "failed") return `scenario failed: ${scenario.error ?? "unknown error"}`;
  return "scenario not run";
}

/** Every metric slot, in table order. */
export function assembleMetrics(
  scenarios: ReadonlyArray<ScenarioRecord>,
  options: { readonly frameMetricTrusted: boolean },
): Array<PerfMetric> {
  const byScenario = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return PERF_METRICS.map(({ id, budgetRow }): PerfMetric => {
    const flagsFor = (own: ReadonlyArray<string> = []) => [
      ...own,
      ...(!options.frameMetricTrusted && FRAME_METRICS.has(id) ? ["frameCadenceUntrusted"] : []),
    ];
    const fixed = FIXED_NOT_MEASURED[id];
    if (fixed !== undefined) {
      return { id, budgetRow, status: "notMeasured", reason: fixed, scenario: null, flags: [] };
    }
    if (id === IDLE_METRIC) {
      const owners = IDLE_OWNERS.map((owner) => byScenario.get(owner));
      const reported = owners
        .filter((owner) => owner?.status === "passed")
        .flatMap((owner) => owner?.idlePoints ?? []);
      const emptyTraceFlags = reported
        .filter((point) => point.value === null)
        .map((point) => `idleTraceEmpty:${point.label}`);
      const points = reported.flatMap((point) =>
        point.value !== null && Number.isInteger(point.value) && point.value >= 0
          ? [{ label: point.label, value: point.value }]
          : [],
      );
      if (points.length === 0) {
        const failed = owners.find((owner) => owner?.status === "failed");
        return {
          id,
          budgetRow,
          status: "notMeasured",
          reason:
            emptyTraceFlags.length > 0 && failed === undefined
              ? "the idle traces held no renderer main-thread events"
              : absentReason(failed),
          scenario: null,
          flags: flagsFor(emptyTraceFlags),
        };
      }
      return {
        id,
        budgetRow,
        status: "measured",
        unit: "count",
        statistic: "max",
        value: Math.max(...points.map((point) => point.value)),
        samples: points.length,
        source: "cdp-trace:PipelineReporter",
        scenario: null,
        flags: flagsFor(emptyTraceFlags),
        points: points.map((point) => ({ label: point.label, atMs: null, value: point.value })),
      };
    }
    const ownerId = OWNER[id] ?? null;
    const owner = ownerId === null ? undefined : byScenario.get(ownerId);
    const outcome =
      owner?.status === "passed" ? owner.metrics.find((metric) => metric.id === id) : undefined;
    if (outcome === undefined) {
      return {
        id,
        budgetRow,
        status: "notMeasured",
        reason: owner?.status === "passed" ? "scenario did not report it" : absentReason(owner),
        scenario: ownerId,
        flags: flagsFor(),
      };
    }
    if (outcome.kind === "notMeasured") {
      return {
        id,
        budgetRow,
        status: "notMeasured",
        reason: outcome.reason,
        scenario: ownerId,
        flags: flagsFor(outcome.flags),
      };
    }
    const points = outcome.points ?? [];
    if (
      !Number.isFinite(outcome.value) ||
      !isCount(outcome.samples) ||
      points.some((point) => !Number.isFinite(point.value))
    ) {
      return {
        id,
        budgetRow,
        status: "notMeasured",
        reason: `measurement was not a finite value (${String(outcome.value)} from ${outcome.source})`,
        scenario: ownerId,
        flags: flagsFor(outcome.flags),
      };
    }
    return {
      id,
      budgetRow,
      status: "measured",
      unit: outcome.unit,
      statistic: outcome.statistic,
      value: outcome.value,
      samples: outcome.samples,
      source: outcome.source,
      scenario: ownerId,
      flags: flagsFor(outcome.flags),
      points: [...points],
    };
  });
}

export type ReportHeader = Omit<PerfReport, "schemaVersion" | "kind" | "metrics" | "scenarios">;

/** The full report; scenarios missing from `scenarios` are listed as skipped. */
export function buildReport(
  input: ReportHeader & { readonly scenarios: ReadonlyArray<ScenarioRecord> },
): PerfReport {
  const { scenarios, ...header } = input;
  const listed = SCENARIO_IDS.map(
    (id): ScenarioRecord =>
      scenarios.find((scenario) => scenario.id === id) ?? {
        id,
        status: "skipped",
        error: null,
        startedAt: null,
        wallTimeMs: null,
        raw: { reason: "not selected" },
        screenshots: [],
        metrics: [],
        idlePoints: [],
      },
  );
  return {
    schemaVersion: 1,
    kind: "e6.web-perf-report",
    ...header,
    metrics: assembleMetrics(listed, { frameMetricTrusted: header.validity.frameMetricTrusted }),
    scenarios: listed.map((scenario) => ({
      id: scenario.id,
      status: scenario.status,
      error: scenario.error,
      startedAt: scenario.startedAt,
      wallTimeMs: scenario.wallTimeMs,
      raw: scenario.raw,
      screenshots: [...scenario.screenshots],
    })),
  };
}

const validate = Schema.decodeUnknownSync(PerfReport);
const encode = Schema.encodeSync(PerfReport);

/** The report as JSON, after the shared schema accepts it; throws when it does not. */
export function encodeReport(report: PerfReport): string {
  return `${JSON.stringify(encode(validate(report)), null, 2)}\n`;
}
