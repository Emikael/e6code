/**
 * Which diff files the reader has marked reviewed, on this device. A mark is advisory: it gates
 * nothing and only helps the reader find where they were. It belongs to a thread, a diff scope
 * and a path, and it remembers what the file looked like, so a file the agent changes again
 * loses its mark.
 */
import type { FileDiffMetadata } from "@pierre/diffs";
import { useCallback, useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { PullRequestFilesViewedView } from "./components/pullRequest/usePullRequestFilesViewed";
import { hunkFingerprints } from "./components/diffs/diffSinceReview.logic";
import { resolveStorage } from "./lib/storage";

/**
 * What a file looked like when it was marked. Git's blob ids on the patch's `index` line are
 * the same whether whitespace is shown or hidden, so they are compared first. A patch without
 * them, or one that has not loaded, falls back to its counts, which only compare under the same
 * whitespace setting; `rawCounts`, the counts with whitespace shown as `git status` reports
 * them, let Run details and a Diff that hides whitespace still compare like with like.
 */
export interface DiffReviewFingerprint {
  /** `prev..next` blob ids from the patch, when it carries them. */
  readonly objects: string | null;
  /** `additions:deletions`. */
  readonly counts: string;
  readonly ignoreWhitespace: boolean;
  /** `additions:deletions` with whitespace shown, when known. */
  readonly rawCounts?: string | null;
  /**
   * Each change's fingerprint when the patch had loaded, so a file changed since can show only
   * the changes it did not have. Marks made before this was kept have none.
   */
  readonly hunks?: ReadonlyArray<string> | null;
}

export interface DiffReviewMark extends DiffReviewFingerprint {
  /** When it was marked, in epoch milliseconds; the oldest marks go first past the cap. */
  readonly at: number;
}

export type DiffReviewStatus = "reviewed" | "changed" | "unreviewed";

/** Marks kept on this device; past this, the oldest are dropped. */
const MAX_DIFF_REVIEW_MARKS = 4000;

const KEY_SEPARATOR = "\u0000";

export function diffReviewKey(threadKey: string, scope: string, path: string): string {
  return [threadKey, scope, path].join(KEY_SEPARATOR);
}

/** A file's fingerprint from its parsed patch, or from its counts alone while it loads. */
export function diffReviewFingerprint(input: {
  readonly fileDiff: FileDiffMetadata | null;
  readonly additions: number;
  readonly deletions: number;
  readonly ignoreWhitespace: boolean;
  /** The file's counts with whitespace shown, as `git status` reports them, when known. */
  readonly rawCounts?: { readonly additions: number; readonly deletions: number } | null;
}): DiffReviewFingerprint {
  const { fileDiff } = input;
  const counts = `${input.additions}:${input.deletions}`;
  const objects =
    fileDiff && (fileDiff.prevObjectId || fileDiff.newObjectId)
      ? `${fileDiff.prevObjectId ?? ""}..${fileDiff.newObjectId ?? ""}`
      : null;
  return {
    objects,
    counts,
    ignoreWhitespace: input.ignoreWhitespace,
    rawCounts: input.rawCounts
      ? `${input.rawCounts.additions}:${input.rawCounts.deletions}`
      : input.ignoreWhitespace
        ? null
        : counts,
    hunks: fileDiff ? hunkFingerprints(fileDiff) : null,
  };
}

/** Whether a mark still holds for the file as it is now, or the file changed since. */
export function diffReviewStatus(
  mark: DiffReviewMark | undefined,
  current: DiffReviewFingerprint,
): DiffReviewStatus {
  if (!mark) return "unreviewed";
  if (mark.objects !== null && current.objects !== null) {
    return mark.objects === current.objects ? "reviewed" : "changed";
  }
  if (mark.ignoreWhitespace === current.ignoreWhitespace) {
    return mark.counts === current.counts ? "reviewed" : "changed";
  }
  if (mark.rawCounts && current.rawCounts) {
    return mark.rawCounts === current.rawCounts ? "reviewed" : "changed";
  }
  // Counts from different whitespace settings say nothing about each other, and a tick that
  // cannot be checked is not shown.
  return "unreviewed";
}

type DiffReviewMarks = Readonly<Record<string, DiffReviewMark>>;

/** Every mark one thread holds for each path, whatever scope it was made in. */
export function diffReviewMarksByPath(
  marks: DiffReviewMarks,
  threadKey: string,
): ReadonlyMap<string, ReadonlyArray<DiffReviewMark>> {
  const prefix = `${threadKey}${KEY_SEPARATOR}`;
  const byPath = new Map<string, DiffReviewMark[]>();
  for (const [key, mark] of Object.entries(marks)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const separator = rest.indexOf(KEY_SEPARATOR);
    if (separator < 0) continue;
    const path = rest.slice(separator + 1);
    const list = byPath.get(path);
    if (list) list.push(mark);
    else byPath.set(path, [mark]);
  }
  return byPath;
}

/**
 * A file's status across the marks of every scope: reviewed when any mark proves it unchanged,
 * else what the newest mark says. A mark that cannot be checked counts as unreviewed, as in Diff.
 */
export function diffReviewStatusAcrossScopes(
  marks: ReadonlyArray<DiffReviewMark> | undefined,
  current: DiffReviewFingerprint,
): DiffReviewStatus {
  if (!marks || marks.length === 0) return "unreviewed";
  if (marks.some((mark) => diffReviewStatus(mark, current) === "reviewed")) return "reviewed";
  const newest = marks.reduce((latest, mark) => (mark.at > latest.at ? mark : latest));
  return diffReviewStatus(newest, current);
}

/** Adds or replaces a mark, dropping the oldest marks past `limit`. */
export function withDiffReviewMark(
  marks: DiffReviewMarks,
  key: string,
  mark: DiffReviewMark,
  limit = MAX_DIFF_REVIEW_MARKS,
): DiffReviewMarks {
  const next: Record<string, DiffReviewMark> = { ...marks, [key]: mark };
  const keys = Object.keys(next);
  if (keys.length <= limit) return next;
  const oldestFirst = keys.toSorted((left, right) => next[left]!.at - next[right]!.at);
  for (const stale of oldestFirst.slice(0, keys.length - limit)) delete next[stale];
  return next;
}

function withoutDiffReviewMark(marks: DiffReviewMarks, key: string): DiffReviewMarks {
  if (!(key in marks)) return marks;
  const { [key]: _removed, ...rest } = marks;
  return rest;
}

/** Every mark of one thread removed, for when the thread is archived. */
export function withoutDiffReviewThread<T>(
  marks: Readonly<Record<string, T>>,
  threadKey: string,
): Readonly<Record<string, T>> {
  const prefix = `${threadKey}${KEY_SEPARATOR}`;
  const keys = Object.keys(marks).filter((key) => key.startsWith(prefix));
  if (keys.length === 0) return marks;
  const next = { ...marks };
  for (const key of keys) delete next[key];
  return next;
}

/** The last change the reader saw in one thread and scope, for "You stopped here". */
export interface DiffLastSeen {
  readonly path: string;
  /** The change's index in the file when it was seen; an index alone goes stale, see `hunk`. */
  readonly change: number;
  /**
   * The change's fingerprint (`hunkFingerprint`), which finds it again after the agent adds or
   * removes changes above it. Positions saved before it was kept have none and are not shown.
   */
  readonly hunk?: string;
  /** ISO time. */
  readonly at: string;
}

/**
 * Where a saved position is in the file now: the index of the change with its fingerprint, or
 * null when that change is gone (or the position predates fingerprints).
 */
export function lastSeenChangeIndex(
  position: DiffLastSeen,
  fingerprints: ReadonlyArray<string>,
): number | null {
  if (!position.hunk) return null;
  const index = fingerprints.indexOf(position.hunk);
  return index < 0 ? null : index;
}

/** Positions kept on this device; past this, the oldest are dropped. */
const MAX_DIFF_LAST_SEEN = 400;

export function diffLastSeenKey(threadKey: string, scope: string): string {
  return [threadKey, scope].join(KEY_SEPARATOR);
}

/** Records a position, dropping the oldest past `limit`. */
export function withDiffLastSeen(
  positions: Readonly<Record<string, DiffLastSeen>>,
  key: string,
  position: DiffLastSeen,
  limit = MAX_DIFF_LAST_SEEN,
): Readonly<Record<string, DiffLastSeen>> {
  const next: Record<string, DiffLastSeen> = { ...positions, [key]: position };
  const keys = Object.keys(next);
  if (keys.length <= limit) return next;
  const oldestFirst = keys.toSorted((left, right) => next[left]!.at.localeCompare(next[right]!.at));
  for (const stale of oldestFirst.slice(0, keys.length - limit)) delete next[stale];
  return next;
}

interface DiffReviewStoreState {
  readonly marks: DiffReviewMarks;
  readonly lastSeen: Readonly<Record<string, DiffLastSeen>>;
  setLastSeen: (key: string, position: DiffLastSeen) => void;
  clearLastSeen: (key: string) => void;
  mark: (key: string, fingerprint: DiffReviewFingerprint) => void;
  unmark: (key: string) => void;
  /** Puts back a mark as it was copied, or removes the key when there was none. */
  restoreMark: (key: string, mark: DiffReviewMark | undefined) => void;
  forgetThread: (threadKey: string) => void;
}

export const useDiffReviewStore = create<DiffReviewStoreState>()(
  persist(
    (set) => ({
      marks: {},
      lastSeen: {},
      setLastSeen: (key, position) =>
        set((state) => {
          const current = state.lastSeen[key];
          if (
            current?.path === position.path &&
            current.change === position.change &&
            current.hunk === position.hunk
          ) {
            return state;
          }
          return { lastSeen: withDiffLastSeen(state.lastSeen, key, position) };
        }),
      clearLastSeen: (key) =>
        set((state) => {
          if (!(key in state.lastSeen)) return state;
          const { [key]: _removed, ...rest } = state.lastSeen;
          return { lastSeen: rest };
        }),
      mark: (key, fingerprint) =>
        set((state) => ({
          marks: withDiffReviewMark(state.marks, key, { ...fingerprint, at: Date.now() }),
        })),
      unmark: (key) => set((state) => ({ marks: withoutDiffReviewMark(state.marks, key) })),
      restoreMark: (key, mark) =>
        set((state) => ({
          marks: mark
            ? withDiffReviewMark(state.marks, key, mark)
            : withoutDiffReviewMark(state.marks, key),
        })),
      forgetThread: (threadKey) =>
        set((state) => ({
          marks: withoutDiffReviewThread(state.marks, threadKey),
          lastSeen: withoutDiffReviewThread(state.lastSeen, threadKey),
        })),
    }),
    {
      name: "e6code:diff-review:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ marks: state.marks, lastSeen: state.lastSeen }),
    },
  ),
);

/** One file the review view knows about: its path and what it looks like now. */
export interface DiffReviewFile {
  readonly path: string;
  readonly fingerprint: DiffReviewFingerprint;
}

export interface DiffReviewView extends PullRequestFilesViewedView {
  readonly statusOf: (path: string) => DiffReviewStatus;
  /**
   * The change fingerprints a file had when it was marked, while it has changed since and they
   * can be compared under the current whitespace setting; else null.
   */
  readonly reviewedHunksOf: (path: string) => ReadonlyArray<string> | null;
  /** Copies a file's mark as it stands; calling the result puts that mark back exactly. */
  readonly snapshot: (path: string) => () => void;
}

/**
 * The local review marks of one thread and scope, behind the same interface the pull request
 * Code tab reads its server-backed viewed state through. Marking stores the file's current
 * fingerprint; the count covers the files given.
 */
export function useDiffReviewView(options: {
  readonly threadKey: string | null;
  readonly scope: string;
  readonly files: ReadonlyArray<DiffReviewFile>;
}): DiffReviewView {
  const { threadKey, scope, files } = options;
  const marks = useDiffReviewStore((state) => state.marks);
  const fingerprints = useMemo(
    () => new Map(files.map((file) => [file.path, file.fingerprint])),
    [files],
  );
  const statusOf = useCallback(
    (path: string): DiffReviewStatus => {
      const fingerprint = fingerprints.get(path);
      if (!threadKey || !fingerprint) return "unreviewed";
      return diffReviewStatus(marks[diffReviewKey(threadKey, scope, path)], fingerprint);
    },
    [fingerprints, marks, scope, threadKey],
  );
  const setViewed = useCallback(
    (path: string, viewed: boolean) => {
      const fingerprint = fingerprints.get(path);
      if (!threadKey) return;
      const key = diffReviewKey(threadKey, scope, path);
      if (viewed && fingerprint) useDiffReviewStore.getState().mark(key, fingerprint);
      else useDiffReviewStore.getState().unmark(key);
    },
    [fingerprints, scope, threadKey],
  );
  const reviewedHunksOf = useCallback(
    (path: string): ReadonlyArray<string> | null => {
      const fingerprint = fingerprints.get(path);
      if (!threadKey || !fingerprint) return null;
      const mark = marks[diffReviewKey(threadKey, scope, path)];
      if (!mark?.hunks || diffReviewStatus(mark, fingerprint) !== "changed") return null;
      // Hiding whitespace reshapes the changes, so fingerprints compare only under one setting.
      return mark.ignoreWhitespace === fingerprint.ignoreWhitespace ? mark.hunks : null;
    },
    [fingerprints, marks, scope, threadKey],
  );
  const viewedCount = useMemo(
    () => files.filter((file) => statusOf(file.path) === "reviewed").length,
    [files, statusOf],
  );
  const snapshot = useCallback(
    (path: string) => {
      if (!threadKey) return noop;
      const key = diffReviewKey(threadKey, scope, path);
      const mark = useDiffReviewStore.getState().marks[key];
      return () => useDiffReviewStore.getState().restoreMark(key, mark);
    },
    [scope, threadKey],
  );
  return {
    enabled: threadKey !== null,
    isViewed: (path) => statusOf(path) === "reviewed",
    isStale: (path) => statusOf(path) === "changed",
    setViewed,
    viewedCount,
    truncated: false,
    error: null,
    refresh: noop,
    statusOf,
    reviewedHunksOf,
    snapshot,
  };
}

function noop() {}

/**
 * Review status for files listed outside the Diff, such as Run details' working tree, counting a
 * mark made in any scope of the thread.
 */
export function useThreadDiffReviewStatuses(options: {
  readonly threadKey: string | null;
  readonly files: ReadonlyArray<DiffReviewFile>;
}): { readonly statusOf: (path: string) => DiffReviewStatus; readonly viewedCount: number } {
  const { threadKey, files } = options;
  const marks = useDiffReviewStore((state) => state.marks);
  const byPath = useMemo(
    () => (threadKey ? diffReviewMarksByPath(marks, threadKey) : new Map()),
    [marks, threadKey],
  );
  const statuses = useMemo(
    () =>
      new Map(
        files.map((file) => [
          file.path,
          diffReviewStatusAcrossScopes(byPath.get(file.path), file.fingerprint),
        ]),
      ),
    [byPath, files],
  );
  const statusOf = useCallback(
    (path: string): DiffReviewStatus => statuses.get(path) ?? "unreviewed",
    [statuses],
  );
  const viewedCount = useMemo(
    () => [...statuses.values()].filter((status) => status === "reviewed").length,
    [statuses],
  );
  return { statusOf, viewedCount };
}

// Each app tab keeps marks in memory; adopt another tab's writes instead of overwriting them on
// the next mark.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === useDiffReviewStore.persist.getOptions().name) {
      void useDiffReviewStore.persist.rehydrate();
    }
  });
}

/** "2 of 5 reviewed". */
export function reviewedCountLabel(reviewed: number, total: number): string {
  return `${reviewed} of ${total} reviewed`;
}
