// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - a host-side HTTP receiver for the server's OTLP metric exports.
/**
 * A local OTLP/HTTP JSON receiver for the web performance harness. Command
 * acknowledgement is an Effect `Metric.timer` that reaches neither the RPC
 * metrics nor the trace file's `metrics-snapshot`, so the harness points
 * `E6CODE_OTLP_METRICS_URL` here and reads the histogram from the exports.
 *
 * Exports are cumulative with one data point per attribute set (command type
 * and acknowledging event type). A window's samples are the per-series delta
 * between the last export at or before its start and the first at or after
 * its end, summed over series; commands in the gaps between those exports and
 * the window edges leak in. The timer's buckets double from 0.5 ms, so the
 * p95 is only an upper bound: the edge of the bucket the 95th rank falls in.
 *
 * @module perf-harness/otlpSink
 */
import * as NodeHttp from "node:http";

import { p95AtMostFromBuckets } from "./stats.ts";

export const COMMAND_ACK_METRIC = "e6_orchestration_command_ack_duration";

export interface HistogramPoint {
  /** The data point's attribute set, as a stable key. */
  readonly series: string;
  readonly timeUnixMs: number;
  readonly bounds: ReadonlyArray<number>;
  readonly counts: ReadonlyArray<number>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const arrayOf = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);

const attributeText = (value: unknown) => {
  if (!isRecord(value)) return "";
  const entry = Object.values(value)[0];
  return typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
    ? String(entry)
    : JSON.stringify(entry);
};

const nanosToMs = (value: unknown) => {
  try {
    return Number(BigInt(String(value)) / 1_000_000n);
  } catch {
    return Number.NaN;
  }
};

/** The histogram data points of `metricName` in one OTLP JSON metrics body. */
export function histogramPoints(body: unknown, metricName: string): Array<HistogramPoint> {
  if (!isRecord(body)) return [];
  const points: Array<HistogramPoint> = [];
  for (const resource of arrayOf(body.resourceMetrics)) {
    if (!isRecord(resource)) continue;
    for (const scope of arrayOf(resource.scopeMetrics)) {
      if (!isRecord(scope)) continue;
      for (const metric of arrayOf(scope.metrics)) {
        if (!isRecord(metric) || metric.name !== metricName || !isRecord(metric.histogram)) {
          continue;
        }
        for (const point of arrayOf(metric.histogram.dataPoints)) {
          if (!isRecord(point)) continue;
          const series = arrayOf(point.attributes)
            .filter(isRecord)
            .map((attribute) => `${String(attribute.key)}=${attributeText(attribute.value)}`)
            .toSorted()
            .join(",");
          points.push({
            series,
            timeUnixMs: nanosToMs(point.timeUnixNano),
            bounds: arrayOf(point.explicitBounds).map(Number),
            counts: arrayOf(point.bucketCounts).map(Number),
          });
        }
      }
    }
  }
  return points;
}

/**
 * Samples recorded between two exports: per series `after` minus `before`
 * (a series missing from `before` counts from zero), summed into one
 * histogram, with the p95 upper bound and the bucket it falls in.
 */
export function ackWindow(input: {
  readonly before: ReadonlyArray<HistogramPoint>;
  readonly after: ReadonlyArray<HistogramPoint>;
}): {
  readonly samples: number;
  readonly bounds: ReadonlyArray<number>;
  readonly counts: ReadonlyArray<number>;
  readonly p95AtMost: number | null;
  readonly bucket: string | null;
  readonly series: number;
} {
  const before = new Map(input.before.map((point) => [point.series, point]));
  const bounds = input.after[0]?.bounds ?? [];
  const counts = Array.from({ length: bounds.length + 1 }, () => 0);
  let series = 0;
  for (const point of input.after) {
    const previous = before.get(point.series);
    const sameBounds = (other: HistogramPoint) =>
      other.bounds.length === bounds.length &&
      other.bounds.every((bound, index) => bound === bounds[index]) &&
      other.counts.length === counts.length;
    if (!sameBounds(point) || (previous !== undefined && !sameBounds(previous))) {
      throw new Error(`histogram series '${point.series}' changed its bucket boundaries`);
    }
    let added = 0;
    for (const [index, count] of point.counts.entries()) {
      const delta = Math.max(0, count - (previous?.counts[index] ?? 0));
      counts[index] = counts[index]! + delta;
      added += delta;
    }
    if (added > 0) series += 1;
  }
  const p95 = p95AtMostFromBuckets({ boundaries: bounds, counts });
  return {
    samples: p95?.samples ?? 0,
    bounds,
    counts,
    p95AtMost: p95?.value ?? null,
    bucket: p95?.bucket ?? null,
    series,
  };
}

export interface OtlpExport {
  readonly receivedAtMs: number;
  /** The export's snapshot time, from its data points; the receive time without any. */
  readonly timeUnixMs: number;
  readonly ack: ReadonlyArray<HistogramPoint>;
}

export interface OtlpSink {
  readonly url: string;
  readonly exports: ReadonlyArray<OtlpExport>;
  /** The last export taken at or before `atMs`. */
  readonly exportAtOrBefore: (atMs: number) => OtlpExport | null;
  /** The first export taken at or after `atMs`, waiting up to `timeoutMs` for it. */
  readonly exportAtOrAfter: (atMs: number, timeoutMs: number) => Promise<OtlpExport | null>;
  readonly close: () => Promise<void>;
}

/** Listens on a free loopback port for `POST /v1/metrics` OTLP JSON bodies. */
export async function startOtlpSink(): Promise<OtlpSink> {
  const exports: Array<OtlpExport> = [];
  const waiters = new Set<() => void>();
  const server = NodeHttp.createServer((request, response) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
      if (request.method !== "POST" || !request.url?.startsWith("/v1/metrics")) return;
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return;
      }
      const receivedAtMs = Date.now();
      const ack = histogramPoints(body, COMMAND_ACK_METRIC);
      const times = ack.map((point) => point.timeUnixMs).filter(Number.isFinite);
      exports.push({
        receivedAtMs,
        timeUnixMs: times.length === 0 ? receivedAtMs : Math.max(...times),
        ack,
      });
      for (const wake of waiters) wake();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("the OTLP sink did not bind a TCP port");
  }
  const atOrAfter = (atMs: number) => exports.find((entry) => entry.timeUnixMs >= atMs) ?? null;
  return {
    url: `http://127.0.0.1:${address.port}/v1/metrics`,
    exports,
    exportAtOrBefore: (atMs) => exports.findLast((entry) => entry.timeUnixMs <= atMs) ?? null,
    exportAtOrAfter: (atMs, timeoutMs) => {
      const found = atOrAfter(atMs);
      if (found !== null) return Promise.resolve(found);
      return new Promise((resolve) => {
        const wake = () => {
          const next = atOrAfter(atMs);
          if (next === null) return;
          clearTimeout(timer);
          waiters.delete(wake);
          resolve(next);
        };
        const timer = setTimeout(() => {
          waiters.delete(wake);
          resolve(null);
        }, timeoutMs);
        waiters.add(wake);
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
