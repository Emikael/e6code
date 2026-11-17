/**
 * Server performance metrics: event-loop delay, encoded RPC bytes, SQLite
 * statement time and shell refetches.
 *
 * Hot paths call the synchronous recorders, which only add into the open
 * interval. Every `INTERVAL_MS` a ticker closes that interval: it samples the
 * event-loop monitor, folds the interval into the since-start totals, keeps it
 * in a five-minute ring and mirrors it into the Effect metrics (and so OTLP).
 * Every `TRACE_EVERY_INTERVALS` intervals, and on shutdown, it writes one
 * `metrics-snapshot` record to the server trace file.
 */
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import type { ServerPerformanceMetricsResult } from "@e6tools/contracts";
import type { SqliteStatementObserver } from "@e6tools/shared/nodeSqliteClient";
import type { MetricsSnapshotTraceRecord, TraceRecord } from "@e6tools/shared/observability";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

import * as ServerConfig from "../config.ts";
import {
  eventLoopDelayMax,
  eventLoopDelayP50,
  eventLoopDelayP99,
  rpcEncodedBytesTotal,
  rpcFramesTotal,
  shellRefetchWindowsTotal,
  shellRefetchesTotal,
  sqliteStatementTimeMsTotal,
  sqliteStatementsTotal,
} from "./Metrics.ts";
import {
  BoundedNames,
  type EventLoopSample,
  IntervalRing,
  OTHERS_KEY,
  PerformanceInterval,
  type RpcFrameKind,
  type ShellRefetchSource,
  eventLoopRollup,
  mergeIntervals,
  rpcTotals,
  shellSummary,
  sqliteTotals,
  topRpcMethods,
  topSqliteStatements,
} from "./PerformanceAggregates.ts";
import { sqlStatementName, sqlStatementSample } from "./sqlStatementName.ts";

export const INTERVAL_MS = 10_000;
const RING_INTERVALS = 30;
export const TRACE_EVERY_INTERVALS = 6;
/**
 * 20 ms keeps the monitor's idle cost near 0.1–0.2% of a core (10 ms doubles
 * it) while every stall long enough to break the 20 ms p99 budget still lands
 * on a sample.
 */
export const EVENT_LOOP_RESOLUTION_MS = 20;
const STATEMENT_NAME_LIMIT = 256;
const SQL_NAME_CACHE_LIMIT = 2_048;
const READ_TOP_ROWS = 25;
const TRACE_TOP_ROWS = 15;
const TRACE_SAMPLE_LENGTH = 100;
export const OVERFLOW_STATEMENT_NAME = "(overflow)";

/** Raw event-loop reading since the previous `read`, as Node reports it. */
export interface EventLoopReading {
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly samples: number;
  readonly utilization: number;
}

export interface EventLoopDelaySource {
  readonly resolutionMs: number;
  /** Returns the delay since the previous call and starts a new sample. */
  readonly read: () => EventLoopReading;
  readonly close: () => void;
}

export function nodeEventLoopDelaySource(resolutionMs: number): EventLoopDelaySource {
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  histogram.enable();
  let lastUtilization = performance.eventLoopUtilization();
  return {
    resolutionMs,
    read: () => {
      const utilization = performance.eventLoopUtilization();
      const delta = performance.eventLoopUtilization(utilization, lastUtilization);
      lastUtilization = utilization;
      const samples = histogram.count;
      const reading = {
        p50Ms: samples === 0 ? 0 : histogram.percentile(50) / 1e6,
        p99Ms: samples === 0 ? 0 : histogram.percentile(99) / 1e6,
        maxMs: samples === 0 ? 0 : histogram.max / 1e6,
        samples,
        utilization: delta.utilization,
      };
      histogram.reset();
      return reading;
    },
    close: () => histogram.disable(),
  };
}

/**
 * Node's monitor times a repeating timer, so an idle loop reads about one
 * resolution. Subtracting it makes 0 mean "no delay".
 */
export function adjustEventLoopReading(
  reading: EventLoopReading,
  resolutionMs: number,
  endedAtMs: number,
): EventLoopSample {
  const adjust = (value: number) => round3(Math.max(0, value - resolutionMs));
  return {
    endedAtMs,
    p50Ms: adjust(reading.p50Ms),
    p99Ms: adjust(reading.p99Ms),
    maxMs: adjust(reading.maxMs),
    rawP50Ms: round3(reading.p50Ms),
    rawP99Ms: round3(reading.p99Ms),
    rawMaxMs: round3(reading.maxMs),
    utilization: round3(reading.utilization),
    samples: reading.samples,
  };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const msToUnixNano = (ms: number) => String(BigInt(Math.round(ms)) * 1_000_000n);

export interface PerformanceMetricsShape {
  readonly enabled: boolean;
  readonly recordFrame: (method: string, kind: RpcFrameKind, bytes: number, values: number) => void;
  /** Passed to the SQLite client; absent when metrics are disabled. */
  readonly sqliteObserver: SqliteStatementObserver<string> | undefined;
  readonly recordShellWindow: (
    source: ShellRefetchSource,
    inputEvents: number,
    refetches: number,
  ) => void;
  readonly recordShellFailure: () => void;
  /** Counts a live `subscribeShell` subscriber for the life of the scope. */
  readonly trackShellSubscriber: Effect.Effect<void, never, Scope.Scope>;
  readonly read: Effect.Effect<ServerPerformanceMetricsResult>;
  /** Since-start totals including the open interval, for exact before/after deltas. */
  readonly totals: () => PerformanceInterval;
}

export class PerformanceMetrics extends Context.Service<
  PerformanceMetrics,
  PerformanceMetricsShape
>()("e6/observability/PerformanceMetrics") {}

const mirrorToMetrics = (interval: PerformanceInterval) =>
  Effect.gen(function* () {
    const sample = interval.eventLoop.at(-1);
    if (sample) {
      yield* Metric.update(eventLoopDelayP50, sample.p50Ms);
      yield* Metric.update(eventLoopDelayP99, sample.p99Ms);
      yield* Metric.update(eventLoopDelayMax, sample.maxMs);
    }
    for (const [method, row] of interval.rpc) {
      for (const [frame, frames, bytes] of [
        ["chunk", row.chunkFrames, row.chunkBytes],
        ["exit", row.exitFrames, row.exitBytes],
      ] as const) {
        if (frames === 0) continue;
        const attributes = { method, frame };
        yield* Metric.update(Metric.withAttributes(rpcFramesTotal, attributes), frames);
        yield* Metric.update(Metric.withAttributes(rpcEncodedBytesTotal, attributes), bytes);
      }
    }
    const sqlite = sqliteTotals(interval);
    if (sqlite.count > 0) {
      yield* Metric.update(sqliteStatementsTotal, sqlite.count);
      yield* Metric.update(sqliteStatementTimeMsTotal, sqlite.totalMs);
    }
    const shell = interval.shell;
    if (shell.windows > 0) {
      yield* Metric.update(shellRefetchWindowsTotal, shell.windows);
      yield* Metric.update(
        Metric.withAttributes(shellRefetchesTotal, { source: "live" }),
        shell.liveRefetches,
      );
      yield* Metric.update(
        Metric.withAttributes(shellRefetchesTotal, { source: "catch-up" }),
        shell.catchUpRefetches,
      );
    }
  });

export const make = Effect.fnUntraced(function* (options: {
  readonly eventLoop: EventLoopDelaySource | undefined;
  readonly pushTrace: ((record: TraceRecord) => void) | undefined;
}) {
  const startedAtMs = yield* Clock.currentTimeMillis;
  const sinceStart = new PerformanceInterval(startedAtMs);
  const ring = new IntervalRing(RING_INTERVALS);
  const statementNames = new BoundedNames(STATEMENT_NAME_LIMIT, OVERFLOW_STATEMENT_NAME);
  const statementSamples = new Map<string, string>();
  const namesBySql = new Map<string, string>();
  let open = new PerformanceInterval(startedAtMs);
  let untracedIntervals = 0;
  let shellSubscribers = 0;
  let maxShellSubscribers = 0;

  const sqliteObserver: SqliteStatementObserver<string> = {
    register: (sql) => {
      let name = namesBySql.get(sql);
      if (name !== undefined) return name;
      // Unprepared statements are prepared on every execute; this cache keeps
      // naming to once per distinct SQL text.
      if (namesBySql.size >= SQL_NAME_CACHE_LIMIT) namesBySql.clear();
      name = statementNames.admit(sqlStatementName(sql));
      namesBySql.set(sql, name);
      if (!statementSamples.has(name)) {
        statementSamples.set(
          name,
          name === OVERFLOW_STATEMENT_NAME
            ? `Statements beyond the first ${STATEMENT_NAME_LIMIT} names`
            : sqlStatementSample(sql),
        );
      }
      return name;
    },
    record: (name, durationMs, ok) => open.recordStatement(name, durationMs, ok),
  };

  const sampleFor = (name: string) =>
    name === OTHERS_KEY ? "Every statement outside this list" : (statementSamples.get(name) ?? "");

  const shellWithSubscribers = (interval: PerformanceInterval) => ({
    subscribers: shellSubscribers,
    maxSubscribers: maxShellSubscribers,
    ...shellSummary(interval),
  });

  const traceRecord = (
    intervals: ReadonlyArray<PerformanceInterval>,
  ): MetricsSnapshotTraceRecord | undefined => {
    if (intervals.length === 0) return undefined;
    const merged = mergeIntervals(intervals, startedAtMs);
    const endedAtMs = merged.endedAtMs ?? merged.startedAtMs;
    const rollup = eventLoopRollup(merged.eventLoop);
    return {
      type: "metrics-snapshot",
      schemaVersion: 1,
      name: "server.performance",
      windowStartUnixNano: msToUnixNano(merged.startedAtMs),
      windowEndUnixNano: msToUnixNano(endedAtMs),
      windowMs: endedAtMs - merged.startedAtMs,
      metrics: {
        intervalMs: INTERVAL_MS,
        eventLoop:
          options.eventLoop === undefined
            ? null
            : {
                resolutionMs: options.eventLoop.resolutionMs,
                worstP99Ms: rollup?.worstP99Ms ?? null,
                maxMs: rollup?.maxMs ?? null,
                intervals: merged.eventLoop.map(({ endedAtMs: sampleEndedAtMs, ...sample }) => ({
                  endUnixNano: msToUnixNano(sampleEndedAtMs),
                  ...sample,
                })),
              },
        rpc: {
          totals: rpcTotals(merged),
          methods: topRpcMethods(merged, TRACE_TOP_ROWS),
        },
        sqlite: {
          totals: {
            ...roundSqliteTotals(sqliteTotals(merged)),
            overflowedNames: statementNames.overflowed,
          },
          statements: topSqliteStatements(merged, TRACE_TOP_ROWS).map((row) => ({
            ...roundStatement(row),
            sample: sampleFor(row.name).slice(0, TRACE_SAMPLE_LENGTH),
          })),
        },
        shell: shellWithSubscribers(merged),
      },
    };
  };

  const writeTrace = () => {
    if (options.pushTrace === undefined || untracedIntervals === 0) return;
    const record = traceRecord(ring.latest(untracedIntervals));
    untracedIntervals = 0;
    if (record) options.pushTrace(record);
  };

  const closeInterval = (nowMs: number) => {
    const closed = open;
    if (options.eventLoop) {
      const reading = options.eventLoop.read();
      if (reading.samples > 0) {
        closed.eventLoop.push(
          adjustEventLoopReading(reading, options.eventLoop.resolutionMs, nowMs),
        );
      }
    }
    closed.endedAtMs = nowMs;
    sinceStart.mergeFrom(closed, false);
    ring.push(closed);
    untracedIntervals = Math.min(untracedIntervals + 1, RING_INTERVALS);
    open = new PerformanceInterval(nowMs);
    return closed;
  };

  const tick = Effect.gen(function* () {
    const closed = closeInterval(yield* Clock.currentTimeMillis);
    if (untracedIntervals >= TRACE_EVERY_INTERVALS) writeTrace();
    yield* mirrorToMetrics(closed);
  });

  yield* Effect.forkScoped(Effect.sleep(INTERVAL_MS).pipe(Effect.andThen(tick), Effect.forever));
  // A run shorter than one trace period still leaves one record behind.
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      if (nowMs > open.startedAtMs) closeInterval(nowMs);
      writeTrace();
    }),
  );

  const read = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const merged = mergeIntervals([...ring.latest(), open], startedAtMs);
    const samples = merged.eventLoop;
    const rollup = eventLoopRollup(samples);
    const latest = samples.at(-1);
    const toInterval = (sample: EventLoopSample) => ({
      endedAt: DateTime.makeUnsafe(sample.endedAtMs),
      p50Ms: sample.p50Ms,
      p99Ms: sample.p99Ms,
      maxMs: sample.maxMs,
      utilization: sample.utilization,
    });
    const sqlite = roundSqliteTotals(sqliteTotals(merged));
    return {
      readAt: DateTime.makeUnsafe(nowMs),
      startedAt: DateTime.makeUnsafe(startedAtMs),
      intervalMs: INTERVAL_MS,
      coveredMs: Math.max(0, nowMs - merged.startedAtMs),
      eventLoop:
        options.eventLoop === undefined || rollup === null || latest === undefined
          ? Option.none()
          : Option.some({
              resolutionMs: options.eventLoop.resolutionMs,
              latest: toInterval(latest),
              worstP99Ms: rollup.worstP99Ms,
              maxMs: rollup.maxMs,
              intervals: samples.map(toInterval),
            }),
      rpcTotals: rpcTotals(merged),
      rpc: topRpcMethods(merged, READ_TOP_ROWS),
      sqliteTotals: {
        count: sqlite.count,
        failures: sqlite.failures,
        totalMs: sqlite.totalMs,
        maxMs: sqlite.maxMs,
        statements: sqlite.statements,
        overflowedNames: statementNames.overflowed,
      },
      sqlite: topSqliteStatements(merged, READ_TOP_ROWS).map((row) => ({
        ...roundStatement(row),
        sample: sampleFor(row.name),
      })),
      shell: shellWithSubscribers(merged),
    } satisfies ServerPerformanceMetricsResult;
  });

  return PerformanceMetrics.of({
    enabled: true,
    recordFrame: (method, kind, bytes, values) => open.recordFrame(method, kind, bytes, values),
    sqliteObserver,
    recordShellWindow: (source, inputEvents, refetches) =>
      open.recordShellWindow(source, inputEvents, refetches),
    recordShellFailure: () => open.recordShellFailure(),
    trackShellSubscriber: Effect.acquireRelease(
      Effect.sync(() => {
        shellSubscribers += 1;
        if (shellSubscribers > maxShellSubscribers) maxShellSubscribers = shellSubscribers;
      }),
      () =>
        Effect.sync(() => {
          shellSubscribers -= 1;
        }),
    ),
    read,
    totals: () => mergeIntervals([sinceStart, open], startedAtMs),
  });
});

const roundSqliteTotals = <T extends { readonly totalMs: number; readonly maxMs: number }>(
  totals: T,
): T => ({ ...totals, totalMs: round3(totals.totalMs), maxMs: round3(totals.maxMs) });

const roundStatement = <
  T extends { readonly totalMs: number; readonly maxMs: number; readonly p95MsAtMost: number },
>(
  row: T,
): T => ({
  ...row,
  totalMs: round3(row.totalMs),
  maxMs: round3(row.maxMs),
  p95MsAtMost: round3(row.p95MsAtMost),
});

const emptyInterval = new PerformanceInterval(0);

/** Records nothing; installed when `E6CODE_PERF_METRICS=false`. */
export const disabled: PerformanceMetricsShape = PerformanceMetrics.of({
  enabled: false,
  recordFrame: () => {},
  sqliteObserver: undefined,
  recordShellWindow: () => {},
  recordShellFailure: () => {},
  trackShellSubscriber: Effect.void,
  read: Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    return {
      readAt: DateTime.makeUnsafe(nowMs),
      startedAt: DateTime.makeUnsafe(nowMs),
      intervalMs: INTERVAL_MS,
      coveredMs: 0,
      eventLoop: Option.none(),
      rpcTotals: rpcTotals(emptyInterval),
      rpc: [],
      sqliteTotals: { ...sqliteTotals(emptyInterval), overflowedNames: 0 },
      sqlite: [],
      shell: { subscribers: 0, maxSubscribers: 0, ...shellSummary(emptyInterval) },
    };
  }),
  totals: () => new PerformanceInterval(0),
});

/**
 * The server's metrics, writing snapshots into the trace file through `pushTrace`.
 * Build it after the trace sink so its shutdown record is flushed by the sink.
 */
export const makeLive = Effect.fnUntraced(function* (pushTrace: (record: TraceRecord) => void) {
  const config = yield* ServerConfig.ServerConfig;
  if (config.performanceMetricsEnabled === false) return disabled;
  const eventLoop = yield* Effect.acquireRelease(
    Effect.sync(() => {
      try {
        return nodeEventLoopDelaySource(EVENT_LOOP_RESOLUTION_MS);
      } catch {
        return undefined;
      }
    }),
    (source) => Effect.sync(() => source?.close()),
  );
  return yield* make({ eventLoop, pushTrace });
});

/** Real aggregation with no event-loop monitor and no trace output, for tests. */
export const layerTest = Layer.effect(
  PerformanceMetrics,
  make({ eventLoop: undefined, pushTrace: undefined }),
);
