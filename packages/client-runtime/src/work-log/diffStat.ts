/** Lines a completed file change added and removed. */
export interface WorkLogDiffStat {
  readonly additions: number;
  readonly deletions: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Same file when equal, or when one is the other's workspace-relative tail. */
function samePath(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

/**
 * The diff stat for a main-agent file-change row, from the per-file counts the
 * server puts on its `changedFiles` payload. `paths` are the files the row
 * lists; each must match a counted entry, or the total is unknown and null is
 * returned rather than an undercount. A row listing no paths takes every
 * entry. Subagent rows (with `agentId`) belong to the subagent file list.
 */
export function mainAgentDiffStat(
  payloadValue: unknown,
  paths: ReadonlyArray<string>,
): WorkLogDiffStat | null {
  const payload = asRecord(payloadValue);
  if (!payload || payload.agentId !== undefined || !Array.isArray(payload.changedFiles)) {
    return null;
  }
  const counted: Array<{ path: string; additions: number; deletions: number }> = [];
  for (const value of payload.changedFiles) {
    const file = asRecord(value);
    if (typeof file?.path !== "string") continue;
    const { additions, deletions } = file;
    if (typeof additions !== "number" || typeof deletions !== "number") {
      // A file without counts makes any total that includes it unknown.
      if (paths.length === 0 || paths.some((path) => samePath(path, file.path as string))) {
        return null;
      }
      continue;
    }
    counted.push({ path: file.path, additions, deletions });
  }
  const selected =
    paths.length === 0
      ? counted
      : paths.map((path) => counted.find((file) => samePath(path, file.path)));
  if (selected.length === 0) return null;
  let additions = 0;
  let deletions = 0;
  for (const file of selected) {
    if (!file) return null;
    additions += file.additions;
    deletions += file.deletions;
  }
  return additions === 0 && deletions === 0 ? null : { additions, deletions };
}
