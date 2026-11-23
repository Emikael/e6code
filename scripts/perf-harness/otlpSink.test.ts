import { describe, expect, it } from "vite-plus/test";

import { ackWindow, histogramPoints, type HistogramPoint } from "./otlpSink.ts";

const ACK = "e6_orchestration_command_ack_duration";
const BOUNDS = [0.5, 1, 2, 4, 8, 16, 32];

/** One OTLP JSON export as `OtlpMetrics` posts it, cumulative, one data point per attribute set. */
const exportBody = (
  timeMs: number,
  points: ReadonlyArray<{ readonly commandType: string; readonly counts: ReadonlyArray<number> }>,
) => ({
  resourceMetrics: [
    {
      resource: { attributes: [] },
      scopeMetrics: [
        {
          scope: { name: "e6" },
          metrics: [
            { name: "e6_orchestration_commands_total", sum: { dataPoints: [{ asInt: 3 }] } },
            {
              name: ACK,
              histogram: {
                aggregationTemporality: 2,
                dataPoints: points.map((point) => ({
                  attributes: [
                    { key: "commandType", value: { stringValue: point.commandType } },
                    { key: "time_unit", value: { stringValue: "milliseconds" } },
                  ],
                  startTimeUnixNano: "0",
                  timeUnixNano: String(BigInt(timeMs) * 1_000_000n),
                  count: point.counts.reduce((sum, count) => sum + count, 0),
                  bucketCounts: point.counts,
                  explicitBounds: BOUNDS,
                })),
              },
            },
          ],
        },
      ],
    },
  ],
});

const counts = (byBucket: Partial<Record<number, number>>) =>
  Array.from({ length: BOUNDS.length + 1 }, (_, index) => byBucket[index] ?? 0);

describe("histogramPoints", () => {
  it("reads one point per attribute set with its export time in ms", () => {
    const points = histogramPoints(
      exportBody(1_700_000_000_123, [
        { commandType: "thread.turn.start", counts: counts({ 2: 1 }) },
        { commandType: "thread.message.assistant.delta", counts: counts({ 3: 4 }) },
      ]),
      ACK,
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      timeUnixMs: 1_700_000_000_123,
      bounds: BOUNDS,
      counts: counts({ 2: 1 }),
    });
    expect(points[0]!.series).not.toBe(points[1]!.series);
  });

  it("ignores other metrics and bodies that are not OTLP", () => {
    expect(histogramPoints(exportBody(1, []), ACK)).toEqual([]);
    expect(histogramPoints({ nope: true }, ACK)).toEqual([]);
    expect(histogramPoints(null, ACK)).toEqual([]);
  });
});

describe("ackWindow", () => {
  const at = (timeMs: number, body: ReturnType<typeof exportBody>): ReadonlyArray<HistogramPoint> =>
    histogramPoints(body, ACK).map((point) => ({ ...point, timeUnixMs: timeMs }));

  it("takes the delta of each series between the exports either side of the window", () => {
    const before = at(1_000, exportBody(1_000, [{ commandType: "a", counts: counts({ 1: 50 }) }]));
    const after = at(
      9_000,
      exportBody(9_000, [
        // 50 old samples at ≤1 ms; 19 new at ≤4 ms and 1 new at ≤16 ms.
        { commandType: "a", counts: counts({ 1: 50, 3: 19, 5: 1 }) },
        // A series first seen after the window opened counts from zero.
        { commandType: "b", counts: counts({ 3: 20 }) },
      ]),
    );
    const window = ackWindow({ before, after });
    expect(window).toMatchObject({
      samples: 40,
      counts: counts({ 3: 39, 5: 1 }),
      p95AtMost: 4,
      bucket: "2-4",
      series: 2,
    });
  });

  it("reports the upper bound of the bucket the 95th rank lands in", () => {
    const after = at(
      5_000,
      exportBody(5_000, [{ commandType: "a", counts: counts({ 4: 90, 5: 10 }) }]),
    );
    expect(ackWindow({ before: [], after })).toMatchObject({
      samples: 100,
      p95AtMost: 16,
      bucket: "8-16",
    });
  });

  it("has no bound when the p95 lands in the overflow bucket", () => {
    const after = at(5_000, exportBody(5_000, [{ commandType: "a", counts: counts({ 7: 3 }) }]));
    expect(ackWindow({ before: [], after })).toMatchObject({ p95AtMost: null, bucket: ">32" });
  });

  it("is empty when no command was acknowledged inside the window", () => {
    const same = at(1_000, exportBody(1_000, [{ commandType: "a", counts: counts({ 1: 5 }) }]));
    expect(ackWindow({ before: same, after: same })).toMatchObject({ samples: 0, p95AtMost: null });
  });

  it("refuses series whose bucket boundaries changed", () => {
    const before = at(1_000, exportBody(1_000, [{ commandType: "a", counts: counts({ 1: 5 }) }]));
    const after = at(
      2_000,
      exportBody(2_000, [{ commandType: "a", counts: counts({ 1: 6 }) }]),
    ).map((point) => ({ ...point, bounds: [1, 2, 3] }));
    expect(() => ackWindow({ before, after })).toThrow(/boundaries/);
  });
});
