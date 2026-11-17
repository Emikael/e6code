/**
 * Allocation-free aggregates for the server performance metrics (event-loop
 * delay, encoded RPC bytes, SQLite statement time, shell refetches).
 *
 * Recorders run on hot paths (every WebSocket frame, every SQLite execute), so
 * rows and histograms are allocated once per key and recording only adds.
 * Histograms use fixed `≤` bucket boundaries placed on the performance budget
 * thresholds, so "how many frames were over 256 KiB" is exact while a
 * percentile is reported as "at most" its bucket's upper bound.
 */

export const FRAME_BYTE_BOUNDARIES: ReadonlyArray<number> = [
  512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 1048576,
];
const SQLITE_MS_BOUNDARIES: ReadonlyArray<number> = [
  0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 1000,
];
const REFETCHES_PER_WINDOW_BOUNDARIES: ReadonlyArray<number> = [
  0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512,
];

export class FixedHistogram {
  readonly boundaries: ReadonlyArray<number>;
  /** One count per boundary, plus a final overflow bucket. */
  readonly counts: Float64Array;
  count = 0;
  sum = 0;
  max = 0;

  constructor(boundaries: ReadonlyArray<number>) {
    this.boundaries = boundaries;
    this.counts = new Float64Array(boundaries.length + 1);
  }

  record(value: number): void {
    const boundaries = this.boundaries;
    let index = 0;
    while (index < boundaries.length && value > boundaries[index]!) index++;
    this.counts[index]! += 1;
    this.count += 1;
    this.sum += value;
    if (value > this.max) this.max = value;
  }

  mergeFrom(other: FixedHistogram): void {
    for (let index = 0; index < this.counts.length; index++) {
      this.counts[index]! += other.counts[index]!;
    }
    this.count += other.count;
    this.sum += other.sum;
    if (other.max > this.max) this.max = other.max;
  }

  /** Number of recorded values strictly greater than `threshold`, which must be a boundary. */
  countAbove(threshold: number): number {
    let total = 0;
    for (let index = 0; index < this.counts.length; index++) {
      if (index === this.boundaries.length || this.boundaries[index]! > threshold) {
        total += this.counts[index]!;
      }
    }
    return total;
  }

  /**
   * An upper bound for the `q` quantile: the boundary of the bucket holding the
   * rank, capped by the exact max (which also covers the overflow bucket).
   */
  quantileAtMost(q: number): number {
    if (this.count === 0) return 0;
    const rank = Math.max(1, Math.ceil(q * this.count));
    let cumulative = 0;
    for (let index = 0; index < this.boundaries.length; index++) {
      cumulative += this.counts[index]!;
      if (cumulative >= rank) return Math.min(this.boundaries[index]!, this.max);
    }
    return this.max;
  }
}

export type RpcFrameKind = "chunk" | "exit";

export interface RpcMethodRow {
  chunkFrames: number;
  chunkValues: number;
  chunkBytes: number;
  exitFrames: number;
  exitBytes: number;
  readonly frameBytes: FixedHistogram;
}

export interface SqliteStatementRow {
  failures: number;
  readonly durationMs: FixedHistogram;
}

export type ShellRefetchSource = "live" | "catch-up";

export interface ShellRow {
  /** Coalescing windows that held at least one event. */
  windows: number;
  inputEvents: number;
  liveRefetches: number;
  catchUpRefetches: number;
  /** Refetch attempts that failed, including ones a retry then recovered. */
  failedReads: number;
  /** Refetches dropped after their retry also failed. */
  failures: number;
  readonly refetchesPerWindow: FixedHistogram;
}

export interface EventLoopSample {
  readonly endedAtMs: number;
  /** Delay with the monitor's resolution subtracted, clamped at 0. */
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Values as Node's histogram reports them, which include the resolution. */
  readonly rawP50Ms: number;
  readonly rawP99Ms: number;
  readonly rawMaxMs: number;
  readonly utilization: number;
  readonly samples: number;
}

const makeRpcRow = (): RpcMethodRow => ({
  chunkFrames: 0,
  chunkValues: 0,
  chunkBytes: 0,
  exitFrames: 0,
  exitBytes: 0,
  frameBytes: new FixedHistogram(FRAME_BYTE_BOUNDARIES),
});

const makeSqliteRow = (): SqliteStatementRow => ({
  failures: 0,
  durationMs: new FixedHistogram(SQLITE_MS_BOUNDARIES),
});

const makeShellRow = (): ShellRow => ({
  windows: 0,
  inputEvents: 0,
  liveRefetches: 0,
  catchUpRefetches: 0,
  failedReads: 0,
  failures: 0,
  refetchesPerWindow: new FixedHistogram(REFETCHES_PER_WINDOW_BOUNDARIES),
});

/**
 * Everything recorded during one fixed interval. The service keeps a ring of
 * closed intervals and a never-reset accumulator for since-start totals.
 */
export class PerformanceInterval {
  readonly startedAtMs: number;
  endedAtMs: number | null = null;
  readonly rpc = new Map<string, RpcMethodRow>();
  readonly sqlite = new Map<string, SqliteStatementRow>();
  readonly shell: ShellRow = makeShellRow();
  readonly eventLoop: Array<EventLoopSample> = [];

  constructor(startedAtMs: number) {
    this.startedAtMs = startedAtMs;
  }

  recordFrame(method: string, kind: RpcFrameKind, bytes: number, values: number): void {
    let row = this.rpc.get(method);
    if (row === undefined) {
      row = makeRpcRow();
      this.rpc.set(method, row);
    }
    if (kind === "chunk") {
      row.chunkFrames += 1;
      row.chunkValues += values;
      row.chunkBytes += bytes;
    } else {
      row.exitFrames += 1;
      row.exitBytes += bytes;
    }
    row.frameBytes.record(bytes);
  }

  recordStatement(name: string, durationMs: number, ok: boolean): void {
    let row = this.sqlite.get(name);
    if (row === undefined) {
      row = makeSqliteRow();
      this.sqlite.set(name, row);
    }
    row.durationMs.record(durationMs);
    if (!ok) row.failures += 1;
  }

  recordShellWindow(source: ShellRefetchSource, inputEvents: number, refetches: number): void {
    const shell = this.shell;
    shell.windows += 1;
    shell.inputEvents += inputEvents;
    if (source === "live") shell.liveRefetches += refetches;
    else shell.catchUpRefetches += refetches;
    shell.refetchesPerWindow.record(refetches);
  }

  recordShellFailedRead(): void {
    this.shell.failedReads += 1;
  }

  recordShellFailure(): void {
    this.shell.failures += 1;
  }

  /** Event-loop samples are left out when merging into the since-start totals, which never shrink. */
  mergeFrom(other: PerformanceInterval, includeEventLoop = true): void {
    for (const [method, source] of other.rpc) {
      let row = this.rpc.get(method);
      if (row === undefined) {
        row = makeRpcRow();
        this.rpc.set(method, row);
      }
      row.chunkFrames += source.chunkFrames;
      row.chunkValues += source.chunkValues;
      row.chunkBytes += source.chunkBytes;
      row.exitFrames += source.exitFrames;
      row.exitBytes += source.exitBytes;
      row.frameBytes.mergeFrom(source.frameBytes);
    }
    for (const [name, source] of other.sqlite) {
      let row = this.sqlite.get(name);
      if (row === undefined) {
        row = makeSqliteRow();
        this.sqlite.set(name, row);
      }
      row.failures += source.failures;
      row.durationMs.mergeFrom(source.durationMs);
    }
    const shell = this.shell;
    shell.windows += other.shell.windows;
    shell.inputEvents += other.shell.inputEvents;
    shell.liveRefetches += other.shell.liveRefetches;
    shell.catchUpRefetches += other.shell.catchUpRefetches;
    shell.failedReads += other.shell.failedReads;
    shell.failures += other.shell.failures;
    shell.refetchesPerWindow.mergeFrom(other.shell.refetchesPerWindow);
    if (includeEventLoop) this.eventLoop.push(...other.eventLoop);
  }
}

/** Fixed-capacity ring of closed intervals, oldest first. */
export class IntervalRing {
  readonly capacity: number;
  private readonly items: Array<PerformanceInterval> = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(interval: PerformanceInterval): void {
    this.items.push(interval);
    if (this.items.length > this.capacity) this.items.shift();
  }

  /** The newest `count` intervals (all of them when omitted), oldest first. */
  latest(count = this.items.length): ReadonlyArray<PerformanceInterval> {
    return this.items.slice(Math.max(0, this.items.length - count));
  }
}

/** Merge intervals into a fresh one that starts at the earliest interval. */
export function mergeIntervals(
  intervals: ReadonlyArray<PerformanceInterval>,
  fallbackStartedAtMs: number,
): PerformanceInterval {
  const merged = new PerformanceInterval(intervals[0]?.startedAtMs ?? fallbackStartedAtMs);
  for (const interval of intervals) merged.mergeFrom(interval);
  merged.endedAtMs = intervals.at(-1)?.endedAtMs ?? null;
  return merged;
}

/**
 * Maps names to a bounded set of keys. Once `capacity` distinct names exist,
 * every new name is pooled under `overflowKey` and counted.
 */
export class BoundedNames {
  readonly capacity: number;
  readonly overflowKey: string;
  private readonly known = new Set<string>();
  overflowed = 0;

  constructor(capacity: number, overflowKey: string) {
    this.capacity = capacity;
    this.overflowKey = overflowKey;
  }

  admit(name: string): string {
    if (this.known.has(name)) return name;
    if (this.known.size >= this.capacity) {
      this.overflowed += 1;
      return this.overflowKey;
    }
    this.known.add(name);
    return name;
  }

  get size(): number {
    return this.known.size;
  }
}

export interface RpcMethodSummary {
  readonly method: string;
  readonly chunkFrames: number;
  readonly chunkValues: number;
  readonly chunkBytes: number;
  readonly exitFrames: number;
  readonly exitBytes: number;
  readonly maxFrameBytes: number;
  readonly p95FrameBytesAtMost: number;
  readonly framesOver4KiB: number;
  readonly framesOver256KiB: number;
}

export interface SqliteStatementSummary {
  readonly name: string;
  readonly count: number;
  readonly failures: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly p95MsAtMost: number;
}

export const OTHERS_KEY = "(others)";

const summarizeRpcRow = (method: string, row: RpcMethodRow): RpcMethodSummary => ({
  method,
  chunkFrames: row.chunkFrames,
  chunkValues: row.chunkValues,
  chunkBytes: row.chunkBytes,
  exitFrames: row.exitFrames,
  exitBytes: row.exitBytes,
  maxFrameBytes: row.frameBytes.max,
  p95FrameBytesAtMost: row.frameBytes.quantileAtMost(0.95),
  framesOver4KiB: row.frameBytes.countAbove(4096),
  framesOver256KiB: row.frameBytes.countAbove(262144),
});

const summarizeSqliteRow = (name: string, row: SqliteStatementRow): SqliteStatementSummary => ({
  name,
  count: row.durationMs.count,
  failures: row.failures,
  totalMs: row.durationMs.sum,
  maxMs: row.durationMs.max,
  p95MsAtMost: row.durationMs.quantileAtMost(0.95),
});

/**
 * The `limit` heaviest rows by `weight`, plus one `(others)` row that merges
 * the rest so column totals stay exact.
 */
function topWithOthers<Row, Summary>(
  rows: ReadonlyMap<string, Row>,
  limit: number,
  weight: (row: Row) => number,
  summarize: (key: string, row: Row) => Summary,
  merge: (into: Row, from: Row) => void,
  makeRow: () => Row,
): Array<Summary> {
  const sorted = [...rows].sort(([, left], [, right]) => weight(right) - weight(left));
  const summaries = sorted.slice(0, limit).map(([key, row]) => summarize(key, row));
  const rest = sorted.slice(limit);
  if (rest.length > 0) {
    const others = makeRow();
    for (const [, row] of rest) merge(others, row);
    summaries.push(summarize(OTHERS_KEY, others));
  }
  return summaries;
}

export function topRpcMethods(
  interval: PerformanceInterval,
  limit: number,
): Array<RpcMethodSummary> {
  return topWithOthers(
    interval.rpc,
    limit,
    (row) => row.chunkBytes + row.exitBytes,
    summarizeRpcRow,
    (into, from) => {
      into.chunkFrames += from.chunkFrames;
      into.chunkValues += from.chunkValues;
      into.chunkBytes += from.chunkBytes;
      into.exitFrames += from.exitFrames;
      into.exitBytes += from.exitBytes;
      into.frameBytes.mergeFrom(from.frameBytes);
    },
    makeRpcRow,
  );
}

export function topSqliteStatements(
  interval: PerformanceInterval,
  limit: number,
): Array<SqliteStatementSummary> {
  return topWithOthers(
    interval.sqlite,
    limit,
    (row) => row.durationMs.sum,
    summarizeSqliteRow,
    (into, from) => {
      into.failures += from.failures;
      into.durationMs.mergeFrom(from.durationMs);
    },
    makeSqliteRow,
  );
}

export function rpcTotals(interval: PerformanceInterval) {
  const all = new FixedHistogram(FRAME_BYTE_BOUNDARIES);
  let bytes = 0;
  for (const row of interval.rpc.values()) {
    all.mergeFrom(row.frameBytes);
    bytes += row.chunkBytes + row.exitBytes;
  }
  return {
    frames: all.count,
    bytes,
    maxFrameBytes: all.max,
    p95FrameBytesAtMost: all.quantileAtMost(0.95),
    framesOver4KiB: all.countAbove(4096),
    framesOver256KiB: all.countAbove(262144),
  };
}

export function sqliteTotals(interval: PerformanceInterval) {
  let count = 0;
  let totalMs = 0;
  let maxMs = 0;
  let failures = 0;
  for (const row of interval.sqlite.values()) {
    count += row.durationMs.count;
    totalMs += row.durationMs.sum;
    if (row.durationMs.max > maxMs) maxMs = row.durationMs.max;
    failures += row.failures;
  }
  return { count, totalMs, maxMs, failures, statements: interval.sqlite.size };
}

export function shellSummary(interval: PerformanceInterval) {
  const shell = interval.shell;
  return {
    windows: shell.windows,
    inputEvents: shell.inputEvents,
    liveRefetches: shell.liveRefetches,
    catchUpRefetches: shell.catchUpRefetches,
    // Each refetch is retried once, so every failed read except a final failure was retried.
    retries: shell.failedReads - shell.failures,
    failures: shell.failures,
    maxRefetchesPerWindow: shell.refetchesPerWindow.max,
    p95RefetchesPerWindowAtMost: shell.refetchesPerWindow.quantileAtMost(0.95),
  };
}

/** Worst p99 and overall max across event-loop samples; `null` when there are none. */
export function eventLoopRollup(samples: ReadonlyArray<EventLoopSample>) {
  if (samples.length === 0) return null;
  let worstP99Ms = 0;
  let maxMs = 0;
  for (const sample of samples) {
    if (sample.p99Ms > worstP99Ms) worstP99Ms = sample.p99Ms;
    if (sample.maxMs > maxMs) maxMs = sample.maxMs;
  }
  return { worstP99Ms, maxMs };
}
