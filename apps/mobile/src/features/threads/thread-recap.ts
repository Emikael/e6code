/**
 * "Where you left off" on mobile (F4, board 9): the shared recap, decided
 * once when a thread opens, from the thread's own log. Mobile has no recap
 * setting, so it follows the web default: after a break of five minutes.
 */
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
  /** "Claude", or "The agent" when the provider is unknown. */
  readonly provider: string;
  readonly note: string | null;
}): ThreadRecap | null {
  const { detail, previous } = input;
  if (previous === null) return null;
  const workLogEntries = deriveWorkLogEntries(detail.activities);
  const latestActivityAt = latestThreadActivityAt({
    messages: detail.messages,
    workLogEntries,
    checkpoints: detail.checkpoints,
  });
  const show = shouldShowThreadRecap({
    trigger: "after-break",
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

/** "14:02" on the day of the visit, else the weekday ("Tue"): never a growing number. */
export function formatRecapSince(since: string, nowMs: number): string {
  const sinceDate = new Date(since);
  if (Number.isNaN(sinceDate.getTime())) return "";
  const now = new Date(nowMs);
  const sameDay =
    sinceDate.getFullYear() === now.getFullYear() &&
    sinceDate.getMonth() === now.getMonth() &&
    sinceDate.getDate() === now.getDate();
  return sameDay
    ? sinceDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : sinceDate.toLocaleDateString(undefined, { weekday: "short" });
}

/** Board 9's file line: "themePalettes.ts +18 −4 · mobileTheme.ts +6 −2", then "+N more". */
export function formatRecapFiles(
  files: ReadonlyArray<Pick<ThreadRecapFile, "path" | "additions" | "deletions">>,
  moreFiles: number,
): string | null {
  if (files.length === 0) return null;
  const parts = files.map(
    (file) => `${file.path.split("/").at(-1) ?? file.path} +${file.additions} −${file.deletions}`,
  );
  if (moreFiles > 0) parts.push(`+${moreFiles} more`);
  return parts.join(" · ");
}
