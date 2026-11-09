import { formatDuration } from "@e6tools/shared/orchestrationTiming";

import type { WorkLogDiffStat } from "./diffStat.ts";
import type { WorkLogToolLifecycleStatus } from "./presentation.ts";

/** The timing and change data a work row reads its stats from. */
interface WorkStepMetaSource {
  /** When the step's latest lifecycle row landed. */
  readonly createdAt: string;
  /** When the step began; absent when only one lifecycle row was seen. */
  readonly startedAt?: string | undefined;
  readonly toolLifecycleStatus?: WorkLogToolLifecycleStatus | undefined;
  readonly diffStat?: WorkLogDiffStat | undefined;
}

/**
 * When a step began once a later lifecycle row of the same step folds into
 * its work row: its tool.started time when either row knows it, else the
 * earlier row's time. Undefined when both rows landed at the same instant.
 * Web and mobile both merge rows with this, so their step durations agree.
 */
export function mergeWorkStepStartedAt(
  previous: { readonly createdAt: string; readonly startedAt?: string | undefined },
  next: { readonly createdAt: string; readonly startedAt?: string | undefined },
): string | undefined {
  return (
    previous.startedAt ??
    next.startedAt ??
    (previous.createdAt !== next.createdAt ? previous.createdAt : undefined)
  );
}

/** What a settled step shows at the right of the thinking timeline. Missing data is null. */
export interface WorkStepMeta {
  /** "1.2s": from the step's first lifecycle row to its terminal one. */
  readonly duration: string | null;
  /** Lines a file change added and removed; null when unknown or both zero. */
  readonly diffStat: WorkLogDiffStat | null;
}

const EMPTY_WORK_STEP_META: WorkStepMeta = { duration: null, diffStat: null };

/**
 * Per-step meta for the thinking timeline, shared by web and mobile. A step
 * still running has no duration yet: the live ring says it is running, and a
 * frozen number would lie.
 */
export function deriveWorkStepMeta(step: WorkStepMetaSource): WorkStepMeta {
  let duration: string | null = null;
  if (
    step.startedAt !== undefined &&
    step.toolLifecycleStatus !== undefined &&
    step.toolLifecycleStatus !== "inProgress"
  ) {
    const span = Date.parse(step.createdAt) - Date.parse(step.startedAt);
    if (Number.isFinite(span) && span > 0) duration = formatDuration(span);
  }
  const diffStat =
    step.diffStat && (step.diffStat.additions > 0 || step.diffStat.deletions > 0)
      ? step.diffStat
      : null;
  return duration === null && diffStat === null ? EMPTY_WORK_STEP_META : { duration, diffStat };
}

/**
 * Where a work row shows its stats: on a thinking-timeline row the meta column
 * carries the diff stat and duration, otherwise the diff stat sits inline.
 * One place only, so a row never shows two diff stats.
 */
export function resolveWorkRowStats(
  step: WorkStepMetaSource,
  timeline: boolean,
): { readonly meta: WorkStepMeta | null; readonly inlineDiffStat: WorkLogDiffStat | null } {
  if (timeline) {
    const meta = deriveWorkStepMeta(step);
    return { meta: meta.duration || meta.diffStat ? meta : null, inlineDiffStat: null };
  }
  return { meta: null, inlineDiffStat: step.diffStat ?? null };
}
