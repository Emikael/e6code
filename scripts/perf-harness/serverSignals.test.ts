import { describe, expect, it } from "vite-plus/test";

import {
  eventLoopInWindow,
  playSegmentRates,
  readTraceRecords,
  snapshotEventLoopIntervals,
} from "./serverSignals.ts";

const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);

describe("eventLoopInWindow", () => {
  const interval = (endedAtMs: number, p99Ms: number) => ({ endedAtMs, p99Ms });

  it("keeps only intervals that lie wholly inside the window and reports their worst p99", () => {
    const intervals = [
      interval(10_000, 1), // [0, 10 s]: starts before the window
      interval(20_000, 7), // [10, 20 s]
      interval(30_000, 3), // [20, 30 s]
      interval(40_000, 50), // [30, 40 s]: ends after the window
    ];
    expect(eventLoopInWindow(intervals, { startMs: 5_000, endMs: 35_000 }, 10_000)).toEqual({
      intervals: [interval(20_000, 7), interval(30_000, 3)],
      maxP99Ms: 7,
    });
  });

  it("counts an interval that starts or ends exactly on the window's edge", () => {
    expect(
      eventLoopInWindow([interval(20_000, 2)], { startMs: 10_000, endMs: 20_000 }, 10_000),
    ).toEqual({ intervals: [interval(20_000, 2)], maxP99Ms: 2 });
  });

  it("has no value when the window holds no whole interval", () => {
    expect(
      eventLoopInWindow([interval(20_000, 2)], { startMs: 12_000, endMs: 25_000 }, 10_000),
    ).toEqual({
      intervals: [],
      maxP99Ms: null,
    });
  });
});

const span = (input: {
  readonly name?: string;
  readonly recording: string;
  readonly step: string;
  readonly events: number;
  readonly elapsedMs: number;
  readonly endMs: number;
}) =>
  JSON.stringify({
    type: "effect-span",
    name: input.name ?? "ReplayProviderAdapter.playSegment",
    traceId: "t",
    spanId: "s",
    startTimeUnixNano: nanos(input.endMs - input.elapsedMs),
    endTimeUnixNano: nanos(input.endMs),
    durationMs: input.elapsedMs,
    attributes: {
      "replay.recording": input.recording,
      "replay.step": input.step,
      "replay.events": input.events,
      "replay.elapsedMs": input.elapsedMs,
    },
    events: [],
    links: [],
  });

describe("readTraceRecords", () => {
  it("parses NDJSON lines and skips torn or blank ones", () => {
    const text = `${JSON.stringify({ type: "effect-span", name: "a" })}\n\n{"type":"eff`;
    expect(readTraceRecords(text)).toEqual([{ type: "effect-span", name: "a" }]);
  });
});

describe("playSegmentRates", () => {
  it("reads each played segment's rate, per recording, inside the window", () => {
    const records = readTraceRecords(
      [
        span({
          recording: "cursor.streaming-prose",
          step: "startSession",
          events: 4,
          elapsedMs: 60,
          endMs: 1_000,
        }),
        span({
          recording: "cursor.streaming-prose",
          step: "sendTurn",
          events: 956,
          elapsedMs: 19_120,
          endMs: 21_000,
        }),
        span({
          recording: "cursor.streaming-prose",
          step: "sendTurn",
          events: 956,
          elapsedMs: 19_200,
          endMs: 42_000,
        }),
        span({
          recording: "codex.subagent-fleet",
          step: "sendTurn",
          events: 100,
          elapsedMs: 1_000,
          endMs: 30_000,
        }),
        span({
          name: "orchestration.command.thread.turn.start",
          recording: "x",
          step: "x",
          events: 1,
          elapsedMs: 1,
          endMs: 2,
        }),
        JSON.stringify({ type: "metrics-snapshot" }),
      ].join("\n"),
    );
    const rates = playSegmentRates(records, { startMs: 1_500, endMs: 50_000 });
    expect(rates["cursor.streaming-prose"]).toEqual({
      segments: 2,
      events: 1_912,
      elapsedMs: 38_320,
      eventsPerSecond: 1_912 / 38.32,
      perSegment: [956 / 19.12, 956 / 19.2],
    });
    expect(rates["codex.subagent-fleet"]?.eventsPerSecond).toBe(100);
  });

  it("leaves out segments that played no events or took no time", () => {
    const records = readTraceRecords(
      span({ recording: "r", step: "sendTurn", events: 0, elapsedMs: 0, endMs: 10 }),
    );
    expect(playSegmentRates(records, null)).toEqual({});
  });
});

describe("snapshotEventLoopIntervals", () => {
  it("collects raw and adjusted p99 per interval from metrics snapshots, once each", () => {
    const record = (endMs: ReadonlyArray<number>) => ({
      type: "metrics-snapshot",
      metrics: {
        intervalMs: 10_000,
        eventLoop: {
          resolutionMs: 20,
          intervals: endMs.map((end) => ({ endUnixNano: nanos(end), p99Ms: 3, rawP99Ms: 23 })),
        },
      },
    });
    expect(
      snapshotEventLoopIntervals([record([10_000, 20_000]), record([20_000, 30_000])]),
    ).toEqual([
      { endedAtMs: 10_000, p99Ms: 3, rawP99Ms: 23 },
      { endedAtMs: 20_000, p99Ms: 3, rawP99Ms: 23 },
      { endedAtMs: 30_000, p99Ms: 3, rawP99Ms: 23 },
    ]);
  });
});
