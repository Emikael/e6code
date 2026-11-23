/**
 * Summary statistics for the web performance harness. Percentiles use the
 * nearest rank, so every reported value is one that was observed.
 *
 * @module perf-harness/stats
 */

/** The nearest-rank percentile of `values` (`p` in 0..1); `null` without samples. */
export function percentile(values: ReadonlyArray<number>, p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

export interface Summary {
  readonly count: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function summarize(values: ReadonlyArray<number>): Summary | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0]!,
    p50: percentile(sorted, 0.5)!,
    p95: percentile(sorted, 0.95)!,
    p99: percentile(sorted, 0.99)!,
    max: sorted[sorted.length - 1]!,
  };
}

/**
 * The p95 of `total` samples of which only `reported` crossed a reporting
 * threshold, as Event Timing reports only events of at least 16 ms. The others
 * count as below the threshold; when the 95th rank falls among them the value
 * is the threshold and `atMost` is true.
 */
export function p95WithUnreported(input: {
  readonly reported: ReadonlyArray<number>;
  readonly total: number;
  readonly thresholdMs: number;
}): { readonly value: number; readonly atMost: boolean; readonly samples: number } | null {
  const samples = Math.max(input.total, input.reported.length);
  if (samples === 0) return null;
  const sorted = input.reported.toSorted((left, right) => left - right);
  const unreported = samples - sorted.length;
  const rank = Math.ceil(0.95 * samples);
  if (rank <= unreported) return { value: input.thresholdMs, atMost: true, samples };
  return { value: sorted[rank - unreported - 1]!, atMost: false, samples };
}

/**
 * An upper bound on the p95 from histogram buckets: `counts[i]` samples fell at
 * or below `boundaries[i]` and above the boundary before it, and the last count
 * is the overflow above the last boundary. `value` is null in the overflow.
 */
export function p95AtMostFromBuckets(input: {
  readonly boundaries: ReadonlyArray<number>;
  readonly counts: ReadonlyArray<number>;
}): { readonly value: number | null; readonly samples: number; readonly bucket: string } | null {
  const samples = input.counts.reduce((sum, count) => sum + count, 0);
  if (samples === 0) return null;
  const rank = Math.ceil(0.95 * samples);
  let cumulative = 0;
  for (const [index, count] of input.counts.entries()) {
    cumulative += count;
    if (cumulative < rank) continue;
    const upper = input.boundaries[index];
    const lower = index === 0 ? 0 : input.boundaries[index - 1]!;
    if (upper === undefined) return { value: null, samples, bucket: `>${lower}` };
    return { value: upper, samples, bucket: `${lower}-${upper}` };
  }
  return null;
}

/**
 * A least-squares slope through `(atMs, value)` samples, per minute, plus the
 * mean of the last third over the mean of the first third.
 */
export function growthSlope(
  points: ReadonlyArray<{ readonly atMs: number; readonly value: number }>,
): { readonly perMinute: number; readonly lastThirdOverFirstThird: number | null } | null {
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.atMs, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.atMs - meanX) * (point.value - meanY);
    denominator += (point.atMs - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const third = Math.max(1, Math.floor(points.length / 3));
  const mean = (slice: ReadonlyArray<{ readonly value: number }>) =>
    slice.reduce((sum, point) => sum + point.value, 0) / slice.length;
  const first = mean(points.slice(0, third));
  const last = mean(points.slice(-third));
  return {
    perMinute: (numerator / denominator) * 60_000,
    lastThirdOverFirstThird: first === 0 ? null : last / first,
  };
}
