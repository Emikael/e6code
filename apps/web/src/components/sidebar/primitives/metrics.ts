export function normalizeCount(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

export function resolveUsage(value: number | null) {
  const percent =
    value !== null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  return {
    percent,
    severity:
      percent === null ? "unknown" : percent >= 95 ? "error" : percent >= 80 ? "warning" : "normal",
  } as const;
}

export function resolvePlanProgress(completed: number, total: number) {
  const steps = normalizeCount(total) ?? 0;
  const done = Math.min(normalizeCount(completed) ?? 0, steps);
  return { completed: done, total: steps, percent: steps === 0 ? 0 : (done / steps) * 100 };
}
