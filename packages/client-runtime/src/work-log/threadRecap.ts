/**
 * "Where you left off" (F4): a short recap of an opened thread, built only
 * from what the thread logged. No model call. A row with nothing to say is
 * left out rather than phrased as a negative, and every row points at its
 * source: the message you asked, the files that changed.
 */
import type { RecapTrigger } from "@e6tools/contracts/settings";

import { samePath, type WorkLogDiffStat } from "@e6tools/client-runtime/work-log/diff-stat";
import {
  summarizeToolGroup,
  toolGroupAction,
  workLogEntryIsToolLike,
} from "@e6tools/client-runtime/work-log/presentation";
import type { WorkLogEntry } from "@e6tools/client-runtime/work-log/entries";

/** Away for at least this long before "after a break" shows the recap. */
export const RECAP_BREAK_MS = 5 * 60 * 1_000;

/** Thread detail carries at most this many activities; at the cap, counts are lower bounds. */
export const THREAD_DETAIL_ACTIVITY_CAP = 500;

/** "You asked" prefers a message at least this long, so "ok" or "go on" never stands for the work. */
const RECAP_ASK_MIN_WORDS = 3;

const MAX_RECAP_FILES = 3;

export interface RecapMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface RecapCheckpoint {
  readonly turnId: string;
  readonly completedAt: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
}

export interface ThreadRecapFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  /** The latest turn that changed it, for opening its diff. */
  readonly turnId: string;
  /**
   * A turn with no checkpoint yet (still running) changed it, so its diff is
   * the working tree's rather than a turn's.
   */
  readonly running: boolean;
  /** False when an edit did not report its line counts: show the file without them. */
  readonly counted: boolean;
}

export interface ThreadRecap {
  /** The previous visit on this device's clock: "changed since 14:02". */
  readonly since: string;
  readonly youAsked: { readonly messageId: string; readonly text: string } | null;
  readonly sinceThen: {
    /** "Claude read 3 files and changed 2 files." */
    readonly summary: string | null;
    readonly files: ReadonlyArray<ThreadRecapFile>;
    readonly moreFiles: number;
  } | null;
  readonly note: string | null;
}

const isAfter = (time: string, since: number) => {
  const ms = Date.parse(time);
  return Number.isFinite(ms) && ms > since;
};

/** The newest thing the thread logged: a message, a work step or a checkpoint. */
export function latestThreadActivityAt(input: {
  readonly messages: ReadonlyArray<Pick<RecapMessage, "createdAt">>;
  readonly workLogEntries: ReadonlyArray<Pick<WorkLogEntry, "createdAt">>;
  readonly checkpoints: ReadonlyArray<Pick<RecapCheckpoint, "completedAt">>;
}): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  const consider = (time: string) => {
    const ms = Date.parse(time);
    if (Number.isFinite(ms) && ms > latestMs) {
      latest = time;
      latestMs = ms;
    }
  };
  for (const message of input.messages) consider(message.createdAt);
  for (const entry of input.workLogEntries) consider(entry.createdAt);
  for (const checkpoint of input.checkpoints) consider(checkpoint.completedAt);
  return latest;
}

/**
 * Whether opening the thread shows the recap. It needs a previous visit and
 * something logged after it; "after-break" also needs that visit to be at
 * least five minutes ago, so switching back and forth stays quiet.
 *
 * Two clocks meet here. `previousVisitAt` and `nowMs` are this device's, so
 * they decide the break. Activity times are the server's, so "something new"
 * compares them with `previousSeenActivityAt`, the newest activity you had
 * already seen, and a remote server's skewed clock cannot hide or repeat work.
 * Without that cursor (an older visit record) the visit time stands in.
 */
export function shouldShowThreadRecap(input: {
  readonly trigger: RecapTrigger;
  readonly previousVisitAt: string | null;
  readonly previousSeenActivityAt?: string | null | undefined;
  readonly latestActivityAt: string | null;
  readonly nowMs: number;
}): boolean {
  if (input.trigger === "never" || !input.previousVisitAt || !input.latestActivityAt) return false;
  const visitMs = Date.parse(input.previousVisitAt);
  const cursorMs = Date.parse(input.previousSeenActivityAt ?? input.previousVisitAt);
  if (!Number.isFinite(visitMs) || !Number.isFinite(cursorMs)) return false;
  if (!isAfter(input.latestActivityAt, cursorMs)) return false;
  return input.trigger === "always" || input.nowMs - visitMs >= RECAP_BREAK_MS;
}

/**
 * The message the work answers: your most recent one of three or more words, so a reply
 * like "ok", "yes" or "go ahead" never stands for the work, else the thread's first message.
 */
export function selectRecapAsk(
  messages: ReadonlyArray<RecapMessage>,
): { readonly messageId: string; readonly text: string } | null {
  const asked = messages.filter((message) => message.role === "user" && message.text.trim());
  let chosen: RecapMessage | undefined;
  for (let index = asked.length - 1; index >= 0; index -= 1) {
    if (asked[index]!.text.trim().split(/\s+/).length >= RECAP_ASK_MIN_WORDS) {
      chosen = asked[index];
      break;
    }
  }
  chosen ??= asked[0];
  return chosen ? { messageId: chosen.id, text: chosen.text.trim() } : null;
}

/**
 * The files an edit step names: its changed files, else the files its line
 * counts name, else, while a file edit runs, the single path its detail
 * carries ("packages/shared/src/themePalettes.ts"). Empty when it names none.
 */
export function editedFilePaths(entry: WorkLogEntry): ReadonlyArray<string> {
  if (entry.changedFiles?.length) return entry.changedFiles;
  if (entry.fileDiffStats?.length) return entry.fileDiffStats.map((file) => file.path);
  const detail = entry.detail?.trim();
  return entry.itemType === "file_change" && detail && !/\s/.test(detail) ? [detail] : [];
}

type MutableRecapFile = { -readonly [Key in keyof ThreadRecapFile]: ThreadRecapFile[Key] };

/** An edit's counts for one of its files, when the provider reported them. */
function editCounts(entry: WorkLogEntry, path: string): WorkLogDiffStat | null {
  const counted = entry.fileDiffStats?.find((file) => samePath(file.path, path));
  if (counted) return counted;
  return entry.changedFiles?.length === 1 && entry.diffStat ? entry.diffStat : null;
}

/**
 * Files changed after `since`, summed per path, most lines first: the turns
 * that finished after it, by their checkpoints, then the edits a turn still
 * running logged after it, before its checkpoint lands. `steps` are the
 * recap's steps, so the list agrees with the summary above it.
 */
function changedFilesSince(
  checkpoints: ReadonlyArray<RecapCheckpoint>,
  steps: ReadonlyArray<WorkLogEntry>,
  sinceMs: number,
): ThreadRecapFile[] {
  const files: MutableRecapFile[] = [];
  const add = (path: string, counts: WorkLogDiffStat | null, turnId: string, running: boolean) => {
    // Checkpoints name files relative to the workspace; edits may name them absolutely.
    const existing = files.find((file) => samePath(file.path, path));
    if (!existing) {
      files.push({
        path,
        additions: counts?.additions ?? 0,
        deletions: counts?.deletions ?? 0,
        turnId,
        running,
        counted: counts !== null,
      });
      return;
    }
    existing.additions += counts?.additions ?? 0;
    existing.deletions += counts?.deletions ?? 0;
    existing.counted &&= counts !== null;
    existing.turnId = turnId;
    existing.running ||= running;
  };
  const ordered = checkpoints
    .filter((checkpoint) => isAfter(checkpoint.completedAt, sinceMs))
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  for (const checkpoint of ordered) {
    for (const file of checkpoint.files) add(file.path, file, checkpoint.turnId, false);
  }
  const checkpointedTurns = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
  for (const step of steps) {
    if (!step.turnId || checkpointedTurns.has(step.turnId) || toolGroupAction(step) !== "edit") {
      continue;
    }
    for (const path of editedFilePaths(step)) {
      add(path, editCounts(step, path), step.turnId, true);
    }
  }
  return files.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
}

/**
 * Builds the recap for a thread whose newest seen activity is `since` (the
 * server's clock). `visitedAt` is when you left, on this device's clock, for
 * the header; it defaults to `since`. Null when every row is empty.
 * `activityCount` is how many activities thread detail returned; at the cap
 * the summary is prefixed "At least", because older steps are cut.
 */
export function deriveThreadRecap(input: {
  readonly since: string;
  readonly visitedAt?: string | undefined;
  readonly messages: ReadonlyArray<RecapMessage>;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly checkpoints: ReadonlyArray<RecapCheckpoint>;
  /** "Claude", or "The agent" when the provider is unknown. */
  readonly provider: string;
  readonly activityCount: number;
  readonly note: string | null;
}): ThreadRecap | null {
  const sinceMs = Date.parse(input.since);
  if (!Number.isFinite(sinceMs)) return null;

  const steps = input.workLogEntries.filter(
    (entry) =>
      entry.tone !== "thinking" &&
      isAfter(entry.createdAt, sinceMs) &&
      workLogEntryIsToolLike(entry),
  );
  const toolSummary = steps.length > 0 ? summarizeToolGroup(steps) : "";
  const summary =
    toolSummary === ""
      ? null
      : `${input.activityCount >= THREAD_DETAIL_ACTIVITY_CAP ? "At least: " : ""}${input.provider} ${toolSummary.charAt(0).toLowerCase()}${toolSummary.slice(1)}.`;
  const files = changedFilesSince(input.checkpoints, steps, sinceMs);
  const sinceThen =
    summary === null && files.length === 0
      ? null
      : {
          summary,
          files: files.slice(0, MAX_RECAP_FILES),
          moreFiles: Math.max(0, files.length - MAX_RECAP_FILES),
        };
  const youAsked = selectRecapAsk(input.messages);
  const note = input.note?.trim() ? input.note.trim() : null;
  if (youAsked === null && sinceThen === null && note === null) return null;
  return { since: input.visitedAt ?? input.since, youAsked, sinceThen, note };
}
