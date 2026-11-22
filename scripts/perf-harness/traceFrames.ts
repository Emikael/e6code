/**
 * Reads Chromium trace events (the JSON `traceEvents` array) for the web
 * performance harness: frame outcomes, idle animation frames, long tasks and
 * script evaluation, all restricted to the page's renderer.
 *
 * Frames come from `PipelineReporter`, the compositor's one-report-per-frame
 * event (category `disabled-by-default-devtools.timeline.frame`), whose
 * `args.frame_reporter.state` says whether the frame was presented in full,
 * presented without some main-thread update, dropped, or not needed. Reports
 * are `b`/`e` async pairs whose local id the compositor reuses. When a build
 * emits none, `DrawFrame` events stand in, which see presented frames only.
 *
 * @module perf-harness/traceFrames
 */
import { summarize, type Summary } from "./stats.ts";

export interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly cat?: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts: number;
  readonly dur?: number;
  readonly id?: string | number;
  readonly id2?: { readonly local?: string; readonly global?: string };
  readonly args?: Record<string, unknown>;
}

const LONG_TASK_MS = 50;
const SCRIPT_EVENTS = new Set([
  "EvaluateScript",
  "v8.compile",
  "v8.compileModule",
  "v8.evaluateModule",
  "v8.run",
  "v8.produceModuleCache",
]);
const TASK_EVENTS = new Set(["RunTask", "ThreadControllerImpl::RunTask"]);

type FrameState = "presentedAll" | "presentedPartial" | "dropped" | "noUpdate";

const STATES: Record<string, FrameState> = {
  STATE_PRESENTED_ALL: "presentedAll",
  STATE_PRESENTED_PARTIAL: "presentedPartial",
  STATE_DROPPED: "dropped",
  STATE_NO_UPDATE_DESIRED: "noUpdate",
};
// When one frame is reported more than once, the best outcome stands.
const STATE_RANK: Record<FrameState, number> = {
  presentedAll: 3,
  presentedPartial: 2,
  dropped: 1,
  noUpdate: 0,
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/**
 * The processes rendering the page's top-level document: every process the
 * outermost main frame started in or committed a navigation to, or, without
 * those browser events, every process with a `CrRendererMain` thread.
 */
export function rendererProcessIds(events: ReadonlyArray<TraceEvent>): Set<number> {
  const pids = new Set<number>();
  for (const event of events) {
    const data = record(event.args?.data);
    if (event.name === "TracingStartedInBrowser") {
      const frames = Array.isArray(data?.frames) ? data.frames : [];
      for (const frame of frames) {
        const entry = record(frame);
        if (entry?.isOutermostMainFrame === true && typeof entry.processId === "number") {
          pids.add(entry.processId);
        }
      }
    } else if (event.name === "FrameCommittedInBrowser") {
      if (data !== undefined && data.parent === undefined && typeof data.processId === "number") {
        pids.add(data.processId);
      }
    }
  }
  if (pids.size > 0) return pids;
  for (const thread of rendererMainThreads(events)) pids.add(thread.pid);
  return pids;
}

function rendererMainThreads(
  events: ReadonlyArray<TraceEvent>,
): Array<{ readonly pid: number; readonly tid: number }> {
  return events
    .filter((event) => event.ph === "M" && event.name === "thread_name")
    .filter((event) => event.args?.name === "CrRendererMain")
    .map((event) => ({ pid: event.pid, tid: event.tid }));
}

interface Frame {
  readonly state: FrameState;
  readonly startTs: number;
  readonly endTs: number | null;
}

function pipelineFrames(events: ReadonlyArray<TraceEvent>, pids: Set<number>): Array<Frame> {
  const open = new Map<string, Array<{ key: string; state: FrameState; startTs: number }>>();
  const frames = new Map<string, { state: FrameState; startTs: number; endTs: number | null }>();
  const sorted = events
    .filter((event) => event.name === "PipelineReporter" && pids.has(event.pid))
    .toSorted((left, right) => left.ts - right.ts);
  for (const event of sorted) {
    const asyncId = `${event.pid}:${event.id2?.local ?? event.id2?.global ?? event.id ?? ""}`;
    if (event.ph === "b") {
      const reporter =
        record(event.args?.frame_reporter) ?? record(event.args?.chrome_frame_reporter);
      const state = STATES[String(reporter?.state)];
      if (state === undefined) continue;
      const key = `${event.pid}:${String(reporter?.frame_source)}:${String(reporter?.frame_sequence)}`;
      const stack = open.get(asyncId) ?? [];
      stack.push({ key, state, startTs: event.ts });
      open.set(asyncId, stack);
    } else if (event.ph === "e") {
      const begun = open.get(asyncId)?.shift();
      if (begun === undefined) continue;
      const existing = frames.get(begun.key);
      if (existing === undefined || STATE_RANK[begun.state] > STATE_RANK[existing.state]) {
        frames.set(begun.key, { state: begun.state, startTs: begun.startTs, endTs: event.ts });
      }
    }
  }
  for (const stack of open.values()) {
    for (const begun of stack) {
      if (!frames.has(begun.key)) {
        frames.set(begun.key, { state: begun.state, startTs: begun.startTs, endTs: null });
      }
    }
  }
  return [...frames.values()].toSorted((left, right) => left.startTs - right.startTs);
}

function drawFrames(events: ReadonlyArray<TraceEvent>, pids: Set<number>): Array<Frame> {
  return events
    .filter((event) => event.name === "DrawFrame" && pids.has(event.pid))
    .toSorted((left, right) => left.ts - right.ts)
    .map((event) => ({ state: "presentedAll" as const, startTs: event.ts, endTs: event.ts }));
}

export interface FrameSummary {
  readonly source: "PipelineReporter" | "DrawFrame" | "none";
  readonly counts: Record<FrameState, number>;
  /** Presented frames over presented plus dropped ones; `null` with neither. */
  readonly withinBudgetFraction: number | null;
  /** Gaps between consecutive presentations, in ms. */
  readonly presentationIntervalsMs: Summary | null;
}

function framesOf(events: ReadonlyArray<TraceEvent>) {
  const pids = rendererProcessIds(events);
  const reported = pipelineFrames(events, pids);
  if (reported.length > 0) return { source: "PipelineReporter" as const, frames: reported };
  const drawn = drawFrames(events, pids);
  if (drawn.length > 0) return { source: "DrawFrame" as const, frames: drawn };
  return { source: "none" as const, frames: [] };
}

/**
 * Frame outcomes for the page. A frame is within budget when it was presented,
 * in full or partially; a dropped frame counts against the budget and a frame
 * with no update desired is not counted, as in DevTools' dropped-frame view.
 */
export function classifyFrames(events: ReadonlyArray<TraceEvent>): FrameSummary {
  const { source, frames } = framesOf(events);
  const counts: Record<FrameState, number> = {
    presentedAll: 0,
    presentedPartial: 0,
    dropped: 0,
    noUpdate: 0,
  };
  for (const frame of frames) counts[frame.state] += 1;
  const presented = counts.presentedAll + counts.presentedPartial;
  const presentations = frames
    .filter((frame) => frame.state === "presentedAll" || frame.state === "presentedPartial")
    .map((frame) => frame.endTs)
    .filter((ts): ts is number => ts !== null)
    .toSorted((left, right) => left - right);
  const intervals = presentations.slice(1).map((ts, index) => (ts - presentations[index]!) / 1000);
  return {
    source,
    counts,
    withinBudgetFraction:
      presented + counts.dropped === 0 ? null : presented / (presented + counts.dropped),
    presentationIntervalsMs: summarize(intervals),
  };
}

/**
 * What a page that should be still did during a trace: frames that produced
 * or attempted an update, and main-thread frames (`BeginMainThreadFrame`).
 * Counted from the trace, so measuring requests no frames of its own. A still
 * page emits no frame reports at all, so `rendererMainEvents` (anything the
 * renderer's main thread recorded) tells "no frames" from "no trace data".
 */
export function idleFrameActivity(events: ReadonlyArray<TraceEvent>): {
  readonly framesWithUpdate: number;
  readonly mainThreadFrames: number;
  readonly rendererMainEvents: number;
  readonly source: FrameSummary["source"];
} {
  const { source, frames } = framesOf(events);
  const pids = rendererProcessIds(events);
  const isMain = onRendererMain(events);
  return {
    framesWithUpdate: frames.filter((frame) => frame.state !== "noUpdate").length,
    mainThreadFrames: events.filter(
      (event) => event.name === "BeginMainThreadFrame" && pids.has(event.pid),
    ).length,
    rendererMainEvents: events.filter((event) => event.ph !== "M" && isMain(event)).length,
    source,
  };
}

const onRendererMain = (events: ReadonlyArray<TraceEvent>) => {
  const pids = rendererProcessIds(events);
  const threads = new Set(
    rendererMainThreads(events)
      .filter((thread) => pids.has(thread.pid))
      .map((thread) => `${thread.pid}:${thread.tid}`),
  );
  return (event: TraceEvent) => threads.has(`${event.pid}:${event.tid}`);
};

/** Durations in ms of renderer main-thread tasks of at least 50 ms, in trace order. */
export function longTaskDurations(events: ReadonlyArray<TraceEvent>): Array<number> {
  const isMain = onRendererMain(events);
  return events
    .filter((event) => event.ph === "X" && TASK_EVENTS.has(event.name) && isMain(event))
    .toSorted((left, right) => left.ts - right.ts)
    .map((event) => (event.dur ?? 0) / 1000)
    .filter((durationMs) => durationMs >= LONG_TASK_MS);
}

/** The trace timestamp of the earliest user-timing mark whose name starts with `prefix`. */
export function userTimingTs(events: ReadonlyArray<TraceEvent>, prefix: string): number | null {
  let earliest: number | null = null;
  for (const event of events) {
    if (!event.name.startsWith(prefix) || !(event.cat ?? "").includes("blink.user_timing"))
      continue;
    if (earliest === null || event.ts < earliest) earliest = event.ts;
  }
  return earliest;
}

/**
 * Milliseconds the renderer main thread spent compiling and evaluating script
 * before `untilTs`, counting nested events once.
 */
export function bootScriptEvaluationMs(
  events: ReadonlyArray<TraceEvent>,
  options: { readonly untilTs: number },
): number {
  const isMain = onRendererMain(events);
  const spans = events
    .filter((event) => event.ph === "X" && SCRIPT_EVENTS.has(event.name) && isMain(event))
    .map((event) => ({
      start: event.ts,
      end: Math.min(event.ts + (event.dur ?? 0), options.untilTs),
    }))
    .filter((span) => span.end > span.start)
    .toSorted((left, right) => left.start - right.start);
  let totalUs = 0;
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    const start = Math.max(span.start, coveredUntil);
    if (span.end > start) totalUs += span.end - start;
    coveredUntil = Math.max(coveredUntil, span.end);
  }
  return totalUs / 1000;
}
