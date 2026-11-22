/**
 * Server-side signals the web performance harness reads besides the browser:
 * event-loop intervals from `server.getPerformanceMetrics` or the trace file's
 * `metrics-snapshot` records, and the provider replay's achieved rate from
 * its `ReplayProviderAdapter.playSegment` spans in the same trace file.
 *
 * Server intervals close on the server's wall clock, and the harness runs on
 * the same machine, so window bounds are wall-clock milliseconds.
 *
 * @module perf-harness/serverSignals
 */

export interface WallWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * The intervals that started and ended inside `window` (an interval covers
 * `[endedAt - intervalMs, endedAt]`), and their worst p99.
 */
export function eventLoopInWindow<A extends { readonly endedAtMs: number; readonly p99Ms: number }>(
  intervals: ReadonlyArray<A>,
  window: WallWindow,
  intervalMs: number,
): { readonly intervals: Array<A>; readonly maxP99Ms: number | null } {
  const inside = intervals.filter(
    (interval) =>
      interval.endedAtMs - intervalMs >= window.startMs && interval.endedAtMs <= window.endMs,
  );
  return {
    intervals: inside,
    maxP99Ms: inside.length === 0 ? null : Math.max(...inside.map((interval) => interval.p99Ms)),
  };
}

export type TraceRecord = Record<string, unknown>;

/** The records of a `server.trace.ndjson` file; a torn last line is skipped. */
export function readTraceRecords(text: string): Array<TraceRecord> {
  const records: Array<TraceRecord> = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        records.push(parsed as TraceRecord);
      }
    } catch {
      // A line still being written when the file was read.
    }
  }
  return records;
}

const nanosToMs = (value: unknown) => {
  try {
    return Number(BigInt(String(value)) / 1_000_000n);
  } catch {
    return Number.NaN;
  }
};

const attributesOf = (record: TraceRecord) =>
  typeof record.attributes === "object" && record.attributes !== null
    ? (record.attributes as Record<string, unknown>)
    : {};

export interface SegmentRate {
  readonly segments: number;
  readonly events: number;
  readonly elapsedMs: number;
  readonly eventsPerSecond: number;
  readonly perSegment: ReadonlyArray<number>;
}

/**
 * The replay's achieved rate per recording: events over elapsed time summed
 * over the `playSegment` spans that ended inside `window` (any, when null).
 */
export function playSegmentRates(
  records: ReadonlyArray<TraceRecord>,
  window: WallWindow | null,
): Record<string, SegmentRate> {
  const byRecording = new Map<string, Array<{ events: number; elapsedMs: number }>>();
  for (const record of records) {
    if (record.name !== "ReplayProviderAdapter.playSegment") continue;
    const attributes = attributesOf(record);
    const events = Number(attributes["replay.events"]);
    const elapsedMs = Number(attributes["replay.elapsedMs"]);
    const endMs = nanosToMs(record.endTimeUnixNano);
    if (!(events > 0) || !(elapsedMs > 0)) continue;
    if (window !== null && !(endMs >= window.startMs && endMs <= window.endMs)) continue;
    const recording = String(attributes["replay.recording"] ?? "unknown");
    byRecording.set(recording, [...(byRecording.get(recording) ?? []), { events, elapsedMs }]);
  }
  return Object.fromEntries(
    [...byRecording.entries()].map(([recording, segments]) => {
      const events = segments.reduce((sum, segment) => sum + segment.events, 0);
      const elapsedMs = segments.reduce((sum, segment) => sum + segment.elapsedMs, 0);
      return [
        recording,
        {
          segments: segments.length,
          events,
          elapsedMs,
          eventsPerSecond: events / (elapsedMs / 1000),
          perSegment: segments.map((segment) => segment.events / (segment.elapsedMs / 1000)),
        },
      ];
    }),
  );
}

/**
 * Event-loop intervals from `metrics-snapshot` records, which also keep the
 * raw p99 Node reported before the monitor resolution was subtracted.
 */
export function snapshotEventLoopIntervals(records: ReadonlyArray<TraceRecord>): Array<{
  readonly endedAtMs: number;
  readonly p99Ms: number;
  readonly rawP99Ms: number;
}> {
  const byEnd = new Map<number, { endedAtMs: number; p99Ms: number; rawP99Ms: number }>();
  for (const record of records) {
    if (record.type !== "metrics-snapshot") continue;
    const metrics = record.metrics as { readonly eventLoop?: { readonly intervals?: unknown } };
    const intervals = Array.isArray(metrics?.eventLoop?.intervals)
      ? (metrics.eventLoop.intervals as ReadonlyArray<Record<string, unknown>>)
      : [];
    for (const interval of intervals) {
      const endedAtMs = nanosToMs(interval.endUnixNano);
      const p99Ms = Number(interval.p99Ms);
      const rawP99Ms = Number(interval.rawP99Ms);
      if (!Number.isFinite(endedAtMs) || !Number.isFinite(p99Ms) || !Number.isFinite(rawP99Ms)) {
        continue;
      }
      byEnd.set(endedAtMs, { endedAtMs, p99Ms, rawP99Ms });
    }
  }
  return [...byEnd.values()].toSorted((left, right) => left.endedAtMs - right.endedAtMs);
}
