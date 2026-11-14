/**
 * "Where you left off" on mobile (F4, board 9): the shared recap, decided
 * once when a thread opens, from the thread's own log, by the device's
 * `recapTrigger` (Settings → Thread behavior), after a break by default.
 */
import type { RecapTrigger } from "@e6tools/contracts/settings";
import type {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationThreadActivity,
} from "@e6tools/contracts";
import { deriveWorkLogEntries } from "@e6tools/client-runtime/work-log/entries";
import {
  deriveThreadRecap,
  latestThreadActivityAt,
  shouldShowThreadRecap,
  type ThreadRecap,
  type ThreadRecapFile,
} from "@e6tools/client-runtime/work-log/thread-recap";

import type { ThreadVisit } from "../../persistence/thread-visits";
import { formatShortTimestamp } from "../../lib/time";

export interface RecapThreadDetail {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
}

/** The newest thing the thread logged, recorded as seen when you leave it. */
export function latestRecapActivityAt(detail: RecapThreadDetail): string | null {
  return latestThreadActivityAt({
    messages: detail.messages,
    workLogEntries: deriveWorkLogEntries(detail.activities),
    checkpoints: detail.checkpoints,
  });
}

/**
 * The recap for a thread you just opened, or null. `previous` is the visit
 * read before this one is recorded; without one there is nothing to recap.
 */
export function decideThreadRecap(input: {
  readonly detail: RecapThreadDetail;
  readonly previous: ThreadVisit | null;
  readonly nowMs: number;
  readonly trigger: RecapTrigger;
  /** "Claude", or "The agent" when the provider is unknown. */
  readonly provider: string;
  readonly note: string | null;
}): ThreadRecap | null {
  const { detail, previous } = input;
  if (previous === null || input.trigger === "never") return null;
  const workLogEntries = deriveWorkLogEntries(detail.activities);
  const latestActivityAt = latestThreadActivityAt({
    messages: detail.messages,
    workLogEntries,
    checkpoints: detail.checkpoints,
  });
  const show = shouldShowThreadRecap({
    trigger: input.trigger,
    previousVisitAt: previous.visitedAt,
    previousSeenActivityAt: previous.seenActivityAt,
    latestActivityAt,
    nowMs: input.nowMs,
  });
  if (!show) return null;
  return deriveThreadRecap({
    since: previous.seenActivityAt ?? previous.visitedAt,
    visitedAt: previous.visitedAt,
    messages: detail.messages,
    workLogEntries,
    checkpoints: detail.checkpoints,
    provider: input.provider,
    activityCount: detail.activities.length,
    note: input.note,
  });
}

/**
 * The visit's time on its day, in the device's locale and hour cycle ("14:02",
 * "2:02 PM"), else the weekday ("Tue"): never a growing number.
 */
export function formatRecapSince(since: string, nowMs: number): string {
  const sinceDate = new Date(since);
  if (Number.isNaN(sinceDate.getTime())) return "";
  const now = new Date(nowMs);
  const sameDay =
    sinceDate.getFullYear() === now.getFullYear() &&
    sinceDate.getMonth() === now.getMonth() &&
    sinceDate.getDate() === now.getDate();
  return sameDay
    ? formatShortTimestamp(since, "locale")
    : sinceDate.toLocaleDateString(undefined, { weekday: "short" });
}

type RecapFileLine = Pick<ThreadRecapFile, "path" | "additions" | "deletions"> & {
  /** False when an edit did not report its line counts; older recaps omit it. */
  readonly counted?: boolean;
};

/** Board 9's file line: "themePalettes.ts +18 −4 · mobileTheme.ts +6 −2", then "+N more". */
export function formatRecapFiles(
  files: ReadonlyArray<RecapFileLine>,
  moreFiles: number,
): string | null {
  if (files.length === 0) return null;
  // A running turn's edit that did not report its line counts shows its name alone.
  const parts = files.map((file) => {
    const name = file.path.split("/").at(-1) ?? file.path;
    return file.counted === false ? name : `${name} +${file.additions} −${file.deletions}`;
  });
  if (moreFiles > 0) parts.push(`+${moreFiles} more`);
  return parts.join(" · ");
}

/**
 * What changed since the visit, read once for the file line and for the
 * "Changes so far" button, so the two always agree: files a running turn
 * edited count as soon as the shared recap lists them.
 */
export function describeRecapChanges(
  sinceThen: { readonly files: ReadonlyArray<RecapFileLine>; readonly moreFiles: number } | null,
): { readonly fileCount: number; readonly line: string | null } {
  if (sinceThen === null) return { fileCount: 0, line: null };
  return {
    fileCount: sinceThen.files.length + sinceThen.moreFiles,
    line: formatRecapFiles(sinceThen.files, sinceThen.moreFiles),
  };
}
