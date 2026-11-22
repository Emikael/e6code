import { describe, expect, it } from "vite-plus/test";

import {
  bootScriptEvaluationMs,
  classifyFrames,
  idleFrameActivity,
  longTaskDurations,
  rendererProcessIds,
  type TraceEvent,
  userTimingTs,
} from "./traceFrames.ts";

const RENDERER = 200;
const RENDERER_MAIN = 201;
const RENDERER_COMPOSITOR = 202;
const BROWSER = 100;

const metadata: ReadonlyArray<TraceEvent> = [
  { name: "process_name", ph: "M", pid: RENDERER, tid: 0, ts: 0, args: { name: "Renderer" } },
  {
    name: "thread_name",
    ph: "M",
    pid: RENDERER,
    tid: RENDERER_MAIN,
    ts: 0,
    args: { name: "CrRendererMain" },
  },
  {
    name: "thread_name",
    ph: "M",
    pid: RENDERER,
    tid: RENDERER_COMPOSITOR,
    ts: 0,
    args: { name: "Compositor" },
  },
  {
    name: "TracingStartedInBrowser",
    ph: "I",
    pid: BROWSER,
    tid: 1,
    ts: 0,
    args: {
      data: {
        frames: [
          { frame: "MAIN", isOutermostMainFrame: true, processId: RENDERER, url: "about:blank" },
          { frame: "CHILD", isOutermostMainFrame: false, processId: 300, url: "https://ad" },
        ],
      },
    },
  },
];

/** One frame as the shell reports it: a `b`/`e` pair whose local id the compositor reuses. */
const frame = (input: {
  readonly sequence: number;
  readonly state: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly id?: string;
  readonly pid?: number;
  readonly source?: number;
}): ReadonlyArray<TraceEvent> => {
  const id2 = { local: input.id ?? "0x1" };
  const base = {
    name: "PipelineReporter",
    cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
    pid: input.pid ?? RENDERER,
    tid: RENDERER_COMPOSITOR,
    id2,
  };
  return [
    {
      ...base,
      ph: "b",
      ts: input.startMs * 1000,
      args: {
        frame_reporter: {
          frame_sequence: input.sequence,
          frame_source: input.source ?? 4294967296,
          state: input.state,
          has_missing_content: false,
          affects_smoothness: false,
        },
      },
    },
    { ...base, ph: "e", ts: input.endMs * 1000, args: {} },
  ];
};

const steadyFrames = (count: number, intervalMs: number, firstSequence = 1) =>
  Array.from({ length: count }, (_, index) =>
    frame({
      sequence: firstSequence + index,
      state: "STATE_PRESENTED_ALL",
      startMs: index * intervalMs,
      endMs: index * intervalMs + 10,
      id: index % 2 === 0 ? "0x1" : "0x2",
    }),
  ).flat();

describe("rendererProcessIds", () => {
  it("takes the process of the outermost main frame", () => {
    expect([...rendererProcessIds(metadata)]).toEqual([RENDERER]);
  });

  it("follows a navigation that committed in another process", () => {
    const committed: TraceEvent = {
      name: "FrameCommittedInBrowser",
      ph: "I",
      pid: BROWSER,
      tid: 1,
      ts: 5,
      args: { data: { frame: "MAIN", processId: 400, url: "http://127.0.0.1:1/" } },
    };
    expect([...rendererProcessIds([...metadata, committed])].toSorted()).toEqual([RENDERER, 400]);
  });

  it("falls back to every process with a renderer main thread", () => {
    expect([...rendererProcessIds(metadata.filter((event) => event.ph === "M"))]).toEqual([
      RENDERER,
    ]);
  });
});

describe("classifyFrames", () => {
  it("counts presented frames against dropped ones and ignores frames with no update", () => {
    const events = [
      ...metadata,
      ...frame({ sequence: 1, state: "STATE_PRESENTED_ALL", startMs: 0, endMs: 10 }),
      ...frame({ sequence: 2, state: "STATE_PRESENTED_PARTIAL", startMs: 16.7, endMs: 27 }),
      ...frame({ sequence: 3, state: "STATE_DROPPED", startMs: 33.4, endMs: 40 }),
      ...frame({ sequence: 4, state: "STATE_NO_UPDATE_DESIRED", startMs: 50, endMs: 51 }),
      ...frame({ sequence: 5, state: "STATE_PRESENTED_ALL", startMs: 66.8, endMs: 77 }),
    ];
    const summary = classifyFrames(events);
    expect(summary.source).toBe("PipelineReporter");
    expect(summary.counts).toEqual({
      presentedAll: 2,
      presentedPartial: 1,
      dropped: 1,
      noUpdate: 1,
    });
    expect(summary.withinBudgetFraction).toBe(0.75);
  });

  it("pairs reused local ids in order and reports presentation intervals", () => {
    const summary = classifyFrames([...metadata, ...steadyFrames(5, 16.7)]);
    expect(summary.counts.presentedAll).toBe(5);
    expect(summary.presentationIntervalsMs?.p50).toBeCloseTo(16.7, 6);
  });

  it("merges reports for one frame sequence, keeping the presented outcome", () => {
    const events = [
      ...metadata,
      ...frame({ sequence: 9, state: "STATE_DROPPED", startMs: 0, endMs: 5, id: "0x1" }),
      ...frame({ sequence: 9, state: "STATE_PRESENTED_ALL", startMs: 0, endMs: 12, id: "0x2" }),
    ];
    expect(classifyFrames(events).counts).toEqual({
      presentedAll: 1,
      presentedPartial: 0,
      dropped: 0,
      noUpdate: 0,
    });
  });

  it("ignores frames from other processes", () => {
    const events = [
      ...metadata,
      ...frame({ sequence: 1, state: "STATE_DROPPED", startMs: 0, endMs: 5, pid: 999 }),
    ];
    expect(classifyFrames(events).counts.dropped).toBe(0);
  });

  it("falls back to DrawFrame events when the shell emits no pipeline reports", () => {
    const draws: ReadonlyArray<TraceEvent> = [0, 16.7, 33.4].map((ms, index) => ({
      name: "DrawFrame",
      ph: "I",
      pid: RENDERER,
      tid: RENDERER_COMPOSITOR,
      ts: ms * 1000,
      args: { frameSeqId: index + 1, layerTreeId: 1 },
    }));
    const summary = classifyFrames([...metadata, ...draws]);
    expect(summary.source).toBe("DrawFrame");
    expect(summary.counts.presentedAll).toBe(3);
    expect(summary.withinBudgetFraction).toBe(1);
    expect(summary.presentationIntervalsMs?.p50).toBeCloseTo(16.7, 6);
  });

  it("has no fraction when nothing was presented or dropped", () => {
    const summary = classifyFrames(metadata);
    expect(summary.source).toBe("none");
    expect(summary.withinBudgetFraction).toBeNull();
    expect(summary.presentationIntervalsMs).toBeNull();
  });
});

describe("idleFrameActivity", () => {
  it("counts frames that produced an update and main-thread frames separately", () => {
    const events = [
      ...metadata,
      ...frame({ sequence: 1, state: "STATE_NO_UPDATE_DESIRED", startMs: 0, endMs: 1 }),
      ...frame({ sequence: 2, state: "STATE_PRESENTED_ALL", startMs: 16.7, endMs: 25 }),
      ...frame({ sequence: 3, state: "STATE_DROPPED", startMs: 33.4, endMs: 40 }),
      {
        name: "BeginMainThreadFrame",
        ph: "I",
        pid: RENDERER,
        tid: RENDERER_MAIN,
        ts: 17_000,
        args: {},
      },
    ];
    expect(idleFrameActivity(events)).toEqual({
      framesWithUpdate: 2,
      mainThreadFrames: 1,
      source: "PipelineReporter",
    });
  });

  it("reads a still page as zero frames", () => {
    expect(idleFrameActivity(metadata)).toEqual({
      framesWithUpdate: 0,
      mainThreadFrames: 0,
      source: "none",
    });
  });
});

describe("longTaskDurations", () => {
  it("returns renderer main-thread tasks of at least 50 ms", () => {
    const task = (durMs: number, tid = RENDERER_MAIN): TraceEvent => ({
      name: "RunTask",
      ph: "X",
      cat: "disabled-by-default-devtools.timeline",
      pid: RENDERER,
      tid,
      ts: 0,
      dur: durMs * 1000,
    });
    const events = [...metadata, task(49), task(50), task(120), task(300, RENDERER_COMPOSITOR)];
    expect(longTaskDurations(events)).toEqual([50, 120]);
  });
});

describe("userTimingTs", () => {
  it("finds the first mark whose name starts with the prefix", () => {
    const events: ReadonlyArray<TraceEvent> = [
      ...metadata,
      { name: "e6:startup:landing:app", ph: "R", cat: "blink.user_timing", pid: 1, tid: 1, ts: 9 },
      { name: "e6:startup:landing:app", ph: "R", cat: "blink.user_timing", pid: 1, tid: 1, ts: 3 },
    ];
    expect(userTimingTs(events, "e6:startup:landing:")).toBe(3);
    expect(userTimingTs(events, "e6:startup:shell-live")).toBeNull();
  });
});

describe("bootScriptEvaluationMs", () => {
  it("adds compile and evaluation time on the renderer main thread, nested time once", () => {
    const script = (name: string, startMs: number, durMs: number, tid = RENDERER_MAIN) => ({
      name,
      ph: "X",
      cat: "devtools.timeline",
      pid: RENDERER,
      tid,
      ts: startMs * 1000,
      dur: durMs * 1000,
    });
    const events = [
      ...metadata,
      script("v8.compileModule", 0, 10),
      script("v8.evaluateModule", 20, 30),
      // Nested inside the evaluation above: already counted.
      script("EvaluateScript", 25, 5),
      script("EvaluateScript", 60, 10),
      // After the cut-off.
      script("EvaluateScript", 200, 40),
      // Another thread.
      script("EvaluateScript", 0, 500, RENDERER_COMPOSITOR),
    ];
    expect(bootScriptEvaluationMs(events, { untilTs: 100_000 })).toBe(50);
  });
});
