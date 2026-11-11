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
import { resolveStorage } from "./lib/storage";

/**
 * What a file looked like when it was marked. Git's blob ids on the patch's `index` line are
 * the same whether whitespace is shown or hidden, so they are compared first. A patch without
 * them, or one that has not loaded, falls back to its counts, which only compare under the same
 * whitespace setting.
 */
export interface DiffReviewFingerprint {
  /** `prev..next` blob ids from the patch, when it carries them. */
  readonly objects: string | null;
  /** `additions:deletions`. */
  readonly counts: string;
  readonly ignoreWhitespace: boolean;
}

export interface DiffReviewMark extends DiffReviewFingerprint {
  /** When it was marked, in epoch milliseconds; the oldest marks go first past the cap. */
  readonly at: number;
}

export type DiffReviewStatus = "reviewed" | "changed" | "unreviewed";

/** Marks kept on this device; past this, the oldest are dropped. */
export const MAX_DIFF_REVIEW_MARKS = 4000;

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
}): DiffReviewFingerprint {
  const { fileDiff } = input;
  const objects =
    fileDiff && (fileDiff.prevObjectId || fileDiff.newObjectId)
      ? `${fileDiff.prevObjectId ?? ""}..${fileDiff.newObjectId ?? ""}`
      : null;
  return {
    objects,
    counts: `${input.additions}:${input.deletions}`,
    ignoreWhitespace: input.ignoreWhitespace,
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
  // Counts differ between whitespace settings, so they say nothing across them.
  if (mark.ignoreWhitespace !== current.ignoreWhitespace) return "reviewed";
  return mark.counts === current.counts ? "reviewed" : "changed";
}

type DiffReviewMarks = Readonly<Record<string, DiffReviewMark>>;

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

export function withoutDiffReviewMark(marks: DiffReviewMarks, key: string): DiffReviewMarks {
  if (!(key in marks)) return marks;
  const { [key]: _removed, ...rest } = marks;
  return rest;
}

/** Every mark of one thread removed, for when the thread is archived. */
export function withoutDiffReviewThread(
  marks: DiffReviewMarks,
  threadKey: string,
): DiffReviewMarks {
  const prefix = `${threadKey}${KEY_SEPARATOR}`;
  const keys = Object.keys(marks).filter((key) => key.startsWith(prefix));
  if (keys.length === 0) return marks;
  const next = { ...marks };
  for (const key of keys) delete next[key];
  return next;
}

interface DiffReviewStoreState {
  readonly marks: DiffReviewMarks;
  mark: (key: string, fingerprint: DiffReviewFingerprint) => void;
  unmark: (key: string) => void;
  forgetThread: (threadKey: string) => void;
}

export const useDiffReviewStore = create<DiffReviewStoreState>()(
  persist(
    (set) => ({
      marks: {},
      mark: (key, fingerprint) =>
        set((state) => ({
          marks: withDiffReviewMark(state.marks, key, { ...fingerprint, at: Date.now() }),
        })),
      unmark: (key) => set((state) => ({ marks: withoutDiffReviewMark(state.marks, key) })),
      forgetThread: (threadKey) =>
        set((state) => ({ marks: withoutDiffReviewThread(state.marks, threadKey) })),
    }),
    {
      name: "e6code:diff-review:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ marks: state.marks }),
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
  const viewedCount = useMemo(
    () => files.filter((file) => statusOf(file.path) === "reviewed").length,
    [files, statusOf],
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
  };
}

function noop() {}

/** "2 of 5 reviewed". */
export function reviewedCountLabel(reviewed: number, total: number): string {
  return `${reviewed} of ${total} reviewed`;
}
