import { assert, describe, it } from "@effect/vitest";
import type { MetricsSnapshotTraceRecord, TraceRecord } from "@e6tools/shared/observability";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import * as PerformanceMetrics from "./PerformanceMetrics.ts";

function fakeEventLoop(readings: Array<PerformanceMetrics.EventLoopReading>) {
  let closed = false;
  const source: PerformanceMetrics.EventLoopDelaySource = {
    resolutionMs: 20,
    read: () => readings.shift() ?? { p50Ms: 0, p99Ms: 0, maxMs: 0, samples: 0, utilization: 0 },
    close: () => {
      closed = true;
    },
  };
  return { source, isClosed: () => closed };
}

const reading = (p50Ms: number, p99Ms: number, maxMs: number) => ({
  p50Ms,
  p99Ms,
  maxMs,
  samples: 500,
  utilization: 0.25,
});

const makeMetrics = (options: {
  readonly eventLoop?: PerformanceMetrics.EventLoopDelaySource;
  readonly traces?: Array<TraceRecord>;
}) =>
  PerformanceMetrics.make({
    eventLoop: options.eventLoop,
    pushTrace: options.traces ? (record) => options.traces!.push(record) : undefined,
  });

const advanceIntervals = (count: number) =>
  TestClock.adjust(`${PerformanceMetrics.INTERVAL_MS * count} millis`);

describe("PerformanceMetrics", () => {
  it.effect("reports event-loop delay with the monitor resolution subtracted", () =>
    Effect.gen(function* () {
      const { source } = fakeEventLoop([reading(21, 45, 120), reading(19, 21, 22)]);
      const metrics = yield* makeMetrics({ eventLoop: source });

      assert.isTrue(Option.isNone((yield* metrics.read).eventLoop));
      yield* advanceIntervals(2);

      const eventLoop = Option.getOrThrow((yield* metrics.read).eventLoop);
      assert.equal(eventLoop.resolutionMs, 20);
      assert.deepInclude(eventLoop.latest, { p50Ms: 0, p99Ms: 1, maxMs: 2, utilization: 0.25 });
      assert.equal(eventLoop.worstP99Ms, 25);
      assert.equal(eventLoop.maxMs, 100);
      assert.equal(eventLoop.intervals.length, 2);
    }),
  );

  it.effect("includes the open interval in reads and keeps since-start totals monotonic", () =>
    Effect.gen(function* () {
      const metrics = yield* makeMetrics({});
      metrics.recordFrame("server.getConfig", "exit", 300, 0);
      assert.equal((yield* metrics.read).rpcTotals.bytes, 300);

      yield* advanceIntervals(1);
      metrics.recordFrame("server.getConfig", "exit", 200, 0);
      const read = yield* metrics.read;
      assert.equal(read.rpcTotals.frames, 2);
      assert.equal(read.coveredMs, PerformanceMetrics.INTERVAL_MS);

      const before = metrics.totals();
      yield* advanceIntervals(40);
      metrics.recordFrame("server.getConfig", "exit", 50, 0);
      const after = metrics.totals();
      assert.equal(after.rpc.get("server.getConfig")?.exitBytes, 550);
      assert.equal(
        (after.rpc.get("server.getConfig")?.exitBytes ?? 0) -
          (before.rpc.get("server.getConfig")?.exitBytes ?? 0),
        50,
      );
      // The five-minute view forgot the first two frames; the totals did not.
      assert.equal((yield* metrics.read).rpcTotals.frames, 1);
    }),
  );

  it.effect("names SQLite statements once per SQL text and pools names past the limit", () =>
    Effect.gen(function* () {
      const metrics = yield* makeMetrics({});
      const observer = metrics.sqliteObserver!;
      const one = observer.register("SELECT * FROM t WHERE id IN (?)");
      const three = observer.register("SELECT * FROM t WHERE id IN (?,?,?)");
      assert.equal(one, three);
      observer.record(one, 2, true);
      observer.record(three, 4, false);

      for (let index = 0; index < 300; index++) {
        observer.record(observer.register(`SELECT c${index} FROM t`), 0.1, true);
      }

      const read = yield* metrics.read;
      const statement = read.sqlite.find((row) => row.name === one);
      assert.deepInclude(statement, { count: 2, failures: 1, totalMs: 6, maxMs: 4 });
      assert.equal(statement?.sample, "SELECT * FROM t WHERE id IN (?+)");
      assert.equal(read.sqliteTotals.count, 302);
      // 256 named statements plus the row that pools the rest.
      assert.equal(read.sqliteTotals.statements, 257);
      assert.equal(read.sqliteTotals.overflowedNames, 300 - 255);
      assert.isTrue(metrics.totals().sqlite.has(PerformanceMetrics.OVERFLOW_STATEMENT_NAME));
    }),
  );

  it.effect("counts shell refetches per window and live subscribers", () =>
    Effect.gen(function* () {
      const metrics = yield* makeMetrics({});
      const subscriberScope = yield* Scope.make();
      yield* metrics.trackShellSubscriber.pipe(Scope.provide(subscriberScope));
      yield* metrics.trackShellSubscriber.pipe(Scope.provide(subscriberScope));
      metrics.recordShellWindow("live", 40, 3);
      metrics.recordShellWindow("catch-up", 21, 9);
      metrics.recordShellFailedRead();
      metrics.recordShellFailedRead();
      metrics.recordShellFailure();
      yield* Scope.close(subscriberScope, Exit.void);

      const shell = (yield* metrics.read).shell;
      assert.deepEqual(shell, {
        subscribers: 0,
        maxSubscribers: 2,
        windows: 2,
        inputEvents: 61,
        liveRefetches: 3,
        catchUpRefetches: 9,
        retries: 1,
        failures: 1,
        maxRefetchesPerWindow: 9,
        p95RefetchesPerWindowAtMost: 9,
      });
    }),
  );

  it.effect("writes one bounded metrics snapshot to the trace every six intervals", () =>
    Effect.gen(function* () {
      const traces: Array<TraceRecord> = [];
      const { source } = fakeEventLoop(
        Array.from({ length: 12 }, () => reading(22.123456, 41.987654, 120.555555)),
      );
      const metrics = yield* makeMetrics({ eventLoop: source, traces });
      // Fill every table past its row limit with long, realistic names.
      for (let index = 0; index < 120; index++) {
        metrics.recordFrame(
          `orchestration.subscribeThreadActivityWindow${index}`,
          index % 2 === 0 ? "chunk" : "exit",
          4000 + index * 997,
          3,
        );
        const name = metrics.sqliteObserver!.register(
          `SELECT ${"column_name_".repeat(20)}${index} FROM projection_thread_activities_${index}`,
        );
        metrics.sqliteObserver!.record(name, 1.234567 + index, index % 7 === 0);
      }
      metrics.recordShellWindow("live", 512, 37);

      yield* advanceIntervals(5);
      assert.equal(traces.length, 0);
      yield* advanceIntervals(1);
      assert.equal(traces.length, 1);

      const record = traces[0] as MetricsSnapshotTraceRecord;
      assert.equal(record.type, "metrics-snapshot");
      assert.equal(record.windowMs, 6 * PerformanceMetrics.INTERVAL_MS);
      assert.notProperty(record, "traceId");
      const eventLoop = record.metrics.eventLoop as { intervals: Array<unknown> };
      assert.equal(eventLoop.intervals.length, 6);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.isAtMost(Buffer.byteLength(JSON.stringify(record)), 8 * 1024);
      const rpc = record.metrics.rpc as { totals: { frames: number }; methods: Array<unknown> };
      assert.equal(rpc.totals.frames, 120);
      assert.equal(rpc.methods.length, 11);

      yield* advanceIntervals(6);
      assert.equal(traces.length, 2);
    }),
  );

  it.effect("writes a partial snapshot on shutdown and closes the monitor", () =>
    Effect.gen(function* () {
      const traces: Array<TraceRecord> = [];
      const scope = yield* Scope.make();
      const metrics = yield* makeMetrics({ traces }).pipe(Scope.provide(scope));
      yield* advanceIntervals(2);
      metrics.recordFrame("server.getConfig", "exit", 10, 0);
      yield* TestClock.adjust("3 seconds");
      yield* Scope.close(scope, Exit.void);

      assert.equal(traces.length, 1);
      const record = traces[0] as MetricsSnapshotTraceRecord;
      assert.equal(record.windowMs, 2 * PerformanceMetrics.INTERVAL_MS + 3_000);
      assert.equal((record.metrics.rpc as { totals: { bytes: number } }).totals.bytes, 10);
    }),
  );

  it.effect("keeps closing intervals when the event-loop monitor throws", () =>
    Effect.gen(function* () {
      const traces: Array<TraceRecord> = [];
      const source: PerformanceMetrics.EventLoopDelaySource = {
        resolutionMs: 20,
        read: () => {
          throw new Error("monitor unavailable");
        },
        close: () => {},
      };
      const metrics = yield* makeMetrics({ eventLoop: source, traces });
      yield* advanceIntervals(1);
      metrics.recordFrame("server.getConfig", "exit", 10, 0);
      yield* advanceIntervals(5);

      assert.isTrue(Option.isNone((yield* metrics.read).eventLoop));
      assert.equal(traces.length, 1);
      assert.equal(metrics.totals().rpc.get("server.getConfig")?.exitFrames, 1);
    }),
  );

  it.effect("records nothing when disabled", () =>
    Effect.gen(function* () {
      const metrics = PerformanceMetrics.disabled;
      metrics.recordFrame("server.getConfig", "exit", 300, 0);
      metrics.recordShellWindow("live", 1, 1);
      const read = yield* metrics.read;
      assert.isFalse(metrics.enabled);
      assert.isUndefined(metrics.sqliteObserver);
      assert.equal(read.rpcTotals.frames, 0);
      assert.equal(read.shell.windows, 0);
    }),
  );
});

describe("adjustEventLoopReading", () => {
  it("clamps at zero and keeps the raw values", () => {
    const sample = PerformanceMetrics.adjustEventLoopReading(reading(19.5, 21.25, 140), 20, 0);
    assert.deepInclude(sample, {
      p50Ms: 0,
      p99Ms: 1.25,
      maxMs: 120,
      rawP50Ms: 19.5,
      rawP99Ms: 21.25,
      rawMaxMs: 140,
    });
  });
});
