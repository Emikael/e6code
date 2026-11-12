import { useEffect, useState } from "react";

/** How much of a pane's output is searched for a local address after each update. */
const LOCAL_ADDRESS_SCAN_CHARS = 8_192;

// Escape sequences (colors, cursor moves, OSC titles and hyperlinks) sit between the words a dev
// server prints, so they are dropped before matching.
const ANSI_SEQUENCE =
  // oxlint-disable-next-line no-control-regex
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-_])/g;
const LOCAL_ADDRESS =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?![\w-]|\.\w)(?::\d{1,5})?(?:\/[^\s"'<>`]*)?/gi;

/**
 * The last local address (localhost, 127.0.0.1, 0.0.0.0 or [::1]) printed near the end of a
 * pane's output, such as a dev server's "Local: http://localhost:5733/". Only the tail is read,
 * so a long-running pane does not rescan its whole history on every chunk.
 */
export function findLocalAddress(output: string): string | null {
  const tail = output.slice(-LOCAL_ADDRESS_SCAN_CHARS).replace(ANSI_SEQUENCE, "");
  const matches = tail.match(LOCAL_ADDRESS);
  const last = matches?.at(-1);
  if (!last) return null;
  // Sentence punctuation after an address is not part of it.
  const trimmed = last.replace(/[.,;:)\]]+$/, "");
  // 0.0.0.0 means "every interface"; a browser reaches it as localhost.
  return trimmed.replace(/^(https?:\/\/)0\.0\.0\.0/i, "$1localhost");
}

/** The end of a pane's retained output, at least `chars` long when that much is kept. */
export function terminalOutputTail(
  chunks: ReadonlyArray<{ readonly data: string }>,
  chars = LOCAL_ADDRESS_SCAN_CHARS,
): string {
  const parts: string[] = [];
  let length = 0;
  for (let index = chunks.length - 1; index >= 0 && length < chars; index -= 1) {
    const data = chunks[index]!.data;
    parts.push(data);
    length += data.length;
  }
  return parts.reverse().join("");
}

/** "localhost:5733", or "localhost:5733/settings" when the address has a path. */
export function localAddressLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** What a pane's header says about its process. */
export type TerminalPaneStatus = "running" | "finished" | "idle";

export function terminalPaneStatus(
  terminalId: string,
  running: ReadonlySet<string>,
  finished: ReadonlySet<string>,
): TerminalPaneStatus {
  if (running.has(terminalId)) return "running";
  return finished.has(terminalId) ? "finished" : "idle";
}

export const TERMINAL_PANE_STATUS_WORD: Record<TerminalPaneStatus, string> = {
  running: "Running",
  finished: "Finished",
  idle: "No process running",
};

/**
 * The Finished cue: a pane whose process stopped while it was out of view says "Finished" until
 * it has been looked at, that is, until it comes into view and leaves it again, or runs again.
 * Returns `finished` itself when nothing changed.
 */
export function nextFinishedTerminalIds(input: {
  readonly finished: ReadonlySet<string>;
  readonly previousRunning: ReadonlyArray<string>;
  readonly running: ReadonlyArray<string>;
  readonly previousInView: ReadonlyArray<string>;
  readonly inView: ReadonlyArray<string>;
}): ReadonlySet<string> {
  const running = new Set(input.running);
  const inView = new Set(input.inView);
  let next: Set<string> | null = null;
  const edit = () => (next ??= new Set(input.finished));
  for (const terminalId of input.previousRunning) {
    if (!running.has(terminalId) && !inView.has(terminalId) && !input.finished.has(terminalId)) {
      edit().add(terminalId);
    }
  }
  for (const terminalId of input.finished) {
    const seen = input.previousInView.includes(terminalId) && !inView.has(terminalId);
    if (running.has(terminalId) || seen) edit().delete(terminalId);
  }
  return next ?? input.finished;
}

const NO_TERMINALS: ReadonlyArray<string> = [];
const NO_FINISHED: ReadonlySet<string> = new Set();

export interface FinishedTerminalState {
  readonly running: ReadonlyArray<string>;
  readonly inView: ReadonlyArray<string>;
  readonly finished: ReadonlySet<string>;
}

/**
 * The Finished cue for a thread the user comes back to. While they were in another thread none
 * of its panes was in view, so a process that stopped meanwhile stopped out of view, and a cue
 * that was on screen when they left has been looked at.
 */
export function resumeFinishedTerminalState(
  stored: FinishedTerminalState | undefined,
  running: ReadonlyArray<string>,
  inView: ReadonlyArray<string>,
): FinishedTerminalState {
  if (!stored) return { running, inView, finished: NO_FINISHED };
  const finished = nextFinishedTerminalIds({
    finished: stored.finished,
    previousRunning: stored.running,
    running,
    previousInView: stored.inView,
    inView: NO_TERMINALS,
  });
  return { running, inView, finished };
}

// The cue outlives the view that computed it, so a process that ends while the user is in
// another thread still reads Finished when they return. Keyed by scoped thread key.
const finishedStateByThread = new Map<string, FinishedTerminalState>();

/**
 * The thread's terminals showing the Finished cue. `running` must keep its identity while it
 * does not change (`useThreadRunningTerminalIds` does); `inView` is compared by contents.
 */
export function useFinishedTerminalIds(
  threadKey: string,
  running: ReadonlyArray<string>,
  /** The terminals on screen; null for none. */
  inViewOrNull: ReadonlyArray<string> | null,
): ReadonlySet<string> {
  const inView = inViewOrNull ?? NO_TERMINALS;
  const [state, setState] = useState(() => ({
    threadKey,
    ...resumeFinishedTerminalState(finishedStateByThread.get(threadKey), running, inView),
  }));
  useEffect(() => {
    finishedStateByThread.set(state.threadKey, state);
  }, [state]);
  const current =
    state.threadKey === threadKey
      ? state
      : {
          threadKey,
          ...resumeFinishedTerminalState(finishedStateByThread.get(threadKey), running, inView),
        };
  const sameInView =
    current.inView.length === inView.length &&
    current.inView.every((terminalId, index) => inView[index] === terminalId);
  if (current !== state || current.running !== running || !sameInView) {
    const finished = nextFinishedTerminalIds({
      finished: current.finished,
      previousRunning: current.running,
      running,
      previousInView: current.inView,
      inView,
    });
    // Adjusting state while rendering: React re-renders at once with the settled value.
    setState({ threadKey, running, inView: sameInView ? current.inView : inView, finished });
    return finished;
  }
  return state.finished;
}

/**
 * Stop sends Ctrl-C, which a background job or a REPL can ignore. A pane whose process is still
 * running a moment after Stop says so instead of reading "Running" as if nothing happened.
 */
export type TerminalStopEvent =
  | { readonly type: "stop-sent"; readonly terminalId: string }
  | { readonly type: "grace-elapsed"; readonly terminalId: string }
  | { readonly type: "running-changed"; readonly running: ReadonlySet<string> };

export interface TerminalStopState {
  /** Stop was pressed and the process has not stopped yet. */
  readonly pending: ReadonlySet<string>;
  /** Still running after the grace period. */
  readonly ignored: ReadonlySet<string>;
}

export const NO_TERMINAL_STOPS: TerminalStopState = { pending: NO_FINISHED, ignored: NO_FINISHED };

/** How long after Ctrl-C a process may take to stop before the pane says it is still running. */
export const TERMINAL_STOP_GRACE_MS = 3_000;

export const TERMINAL_STOP_IGNORED_NOTICE = "Sent Ctrl-C. The process is still running.";

export function nextTerminalStopState(
  state: TerminalStopState,
  event: TerminalStopEvent,
): TerminalStopState {
  switch (event.type) {
    case "stop-sent": {
      if (state.pending.has(event.terminalId)) return state;
      return { ...state, pending: new Set(state.pending).add(event.terminalId) };
    }
    case "grace-elapsed": {
      if (!state.pending.has(event.terminalId) || state.ignored.has(event.terminalId)) return state;
      return { ...state, ignored: new Set(state.ignored).add(event.terminalId) };
    }
    case "running-changed": {
      const running = event.running;
      const keep = (ids: ReadonlySet<string>) => {
        const kept = [...ids].filter((terminalId) => running.has(terminalId));
        return kept.length === ids.size ? ids : new Set(kept);
      };
      const pending = keep(state.pending);
      const ignored = keep(state.ignored);
      return pending === state.pending && ignored === state.ignored ? state : { pending, ignored };
    }
  }
}
