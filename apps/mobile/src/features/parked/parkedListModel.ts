import { applyParkedOps, type ParkedOp } from "@e6tools/client-runtime/parked-sync";
import {
  PARKED_THOUGHTS_MAX,
  type EnvironmentId,
  type OrchestrationParkedEntry,
  type OrchestrationParkedState,
} from "@e6tools/contracts";

/** One parked thought on the mobile Parked screen. */
export interface ParkedRow {
  readonly environmentId: EnvironmentId;
  readonly entry: OrchestrationParkedEntry;
}

/**
 * Every synced environment's thoughts with this phone's unsent changes
 * applied, newest first. Notes stay with their thread, as on the web.
 */
export function buildParkedRows(
  lists: ReadonlyMap<EnvironmentId, OrchestrationParkedState>,
  ops: ReadonlyArray<ParkedOp>,
): ReadonlyArray<ParkedRow> {
  const rows: ParkedRow[] = [];
  for (const [environmentId, state] of lists) {
    const view = applyParkedOps(
      state.entries,
      ops.filter((op) => op.environmentId === environmentId),
    );
    for (const entry of view) {
      if (entry.kind === "thought") rows.push({ environmentId, entry });
    }
  }
  return [...rows].sort(
    (left, right) =>
      right.entry.createdAt.localeCompare(left.entry.createdAt) ||
      right.entry.id.localeCompare(left.entry.id),
  );
}

/** Whether `environmentId` can take another thought; past the cap it is refused, never evicted. */
export function canParkIn(rows: ReadonlyArray<ParkedRow>, environmentId: EnvironmentId): boolean {
  return rows.filter((row) => row.environmentId === environmentId).length < PARKED_THOUGHTS_MAX;
}

/** "14:09" today, else the short date: when it was parked. */
export function formatParkedTime(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  const sameDay = created.toDateString() === now.toDateString();
  return sameDay
    ? created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
