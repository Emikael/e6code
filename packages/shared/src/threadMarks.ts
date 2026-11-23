/**
 * `performance.mark` names the web client sets when a thread route shows its
 * history, read by the web performance harness's thread-switch scenario. Like
 * the startup marks, values ride in the name. Redesigned (v2) thread screens
 * must set the same marks.
 *
 * Marks describe one visit to a thread route: the client sets each at most
 * once per visit, in the frame after the change shows.
 */
export const THREAD_MARK_PREFIX = "e6:thread:";

/** The routed thread's sync status when its first rows showed. */
export type ThreadRowsStatus = "cached" | "synchronizing" | "live";

/** The client's per-thread status, as `client-runtime` names it. */
export type ThreadMarkSourceStatus = "empty" | ThreadRowsStatus | "deleted";

export interface ThreadMarkProgress {
  readonly rows: boolean;
  readonly live: boolean;
}

const ROWS_MARK = `${THREAD_MARK_PREFIX}rows:`;
const LIVE_MARK = `${THREAD_MARK_PREFIX}live`;
const ROWS_STATUSES: ReadonlySet<string> = new Set<ThreadRowsStatus>([
  "cached",
  "synchronizing",
  "live",
]);

/** The first frame with rows for the routed thread, by the status it showed them in. */
export const threadRowsMark = (status: ThreadRowsStatus): string => `${ROWS_MARK}${status}`;

/** The first frame in which the routed thread is live and shows rows. */
export const threadLiveMark = (): string => LIVE_MARK;

/**
 * The marks to set now for a routed thread, given its status, whether its own
 * rows are on screen, and which marks this visit already set. Rows shown while
 * the thread has no state yet were remembered from an earlier visit, so they
 * count as cached. A deleted thread never marks.
 */
export function nextThreadMarks(input: {
  readonly status: ThreadMarkSourceStatus;
  readonly hasRows: boolean;
  readonly marked: ThreadMarkProgress;
}): ReadonlyArray<string> {
  if (input.status === "deleted" || !input.hasRows) return [];
  const marks: Array<string> = [];
  if (!input.marked.rows) {
    marks.push(threadRowsMark(input.status === "empty" ? "cached" : input.status));
  }
  if (!input.marked.live && input.status === "live") marks.push(threadLiveMark());
  return marks;
}

export type ParsedThreadMark =
  | { readonly kind: "rows"; readonly status: ThreadRowsStatus }
  | { readonly kind: "live" };

/** Reads a mark set with one of the builders above; anything else is `null`. */
export function parseThreadMark(name: string): ParsedThreadMark | null {
  if (name === LIVE_MARK) return { kind: "live" };
  if (!name.startsWith(ROWS_MARK)) return null;
  const status = name.slice(ROWS_MARK.length);
  return ROWS_STATUSES.has(status) ? { kind: "rows", status: status as ThreadRowsStatus } : null;
}

/** Which kinds `names` cover: the marks a visit has set, plus those still waiting for a frame. */
export function threadMarkProgress(names: Iterable<string>): ThreadMarkProgress {
  let rows = false;
  let live = false;
  for (const name of names) {
    const kind = parseThreadMark(name)?.kind;
    if (kind === "rows") rows = true;
    if (kind === "live") live = true;
  }
  return { rows, live };
}
