import type { MotionLevel } from "@e6tools/client-runtime/motion-level";
import { describe, expect, it } from "vite-plus/test";

import { type CinematicTimeline, runTimeline } from "./runTimeline.ts";

/** Records what the runner asked of the timeline; `complete()` ends a playing one. */
class FakeTimeline implements CinematicTimeline {
  readonly calls: Array<string> = [];
  readonly built: Array<string> = [];
  private finish: (() => void) | null = null;
  private playing: () => void;
  readonly started: Promise<void>;

  constructor() {
    let resolve!: () => void;
    this.started = new Promise((done) => (resolve = done));
    this.playing = resolve;
  }

  play() {
    this.calls.push("play");
    this.playing();
  }
  progress(value: 1) {
    this.calls.push(`progress(${value})`);
  }
  kill() {
    this.calls.push("kill");
  }
  onComplete(callback: () => void) {
    this.finish = callback;
  }
  complete() {
    this.finish?.();
  }
}

const fakePolicy = (initial: MotionLevel) => {
  let level = initial;
  const listeners = new Set<() => void>();
  return {
    getLevel: () => level,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next: MotionLevel) {
      level = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
};

const setup = (level: MotionLevel) => {
  const timeline = new FakeTimeline();
  const policy = fakePolicy(level);
  const engine = Promise.resolve({ createTimeline: () => timeline });
  const sequence = {
    full: (tl: FakeTimeline) => void tl.built.push("full"),
    reduced: (tl: FakeTimeline) => void tl.built.push("reduced"),
  };
  return { timeline, policy, load: () => engine, sequence };
};

describe("runTimeline", () => {
  it("plays the full sequence at Full until it completes", async () => {
    const { timeline, policy, load, sequence } = setup("full");
    const run = runTimeline({ load, sequence, policy });
    await timeline.started;
    timeline.complete();

    expect(await run).toBe("played");
    expect(timeline.built).toEqual(["full"]);
    expect(timeline.calls).toEqual(["play"]);
    expect(policy.listenerCount()).toBe(0);
  });

  it("plays the declared reduced form at Reduced", async () => {
    const { timeline, policy, load, sequence } = setup("reduced");
    const run = runTimeline({ load, sequence, policy });
    await timeline.started;
    timeline.complete();

    expect(await run).toBe("played");
    expect(timeline.built).toEqual(["reduced"]);
  });

  it("jumps to the end state without a frame at Off", async () => {
    const { timeline, policy, load, sequence } = setup("off");

    expect(await runTimeline({ load, sequence, policy })).toBe("finished");
    expect(timeline.built).toEqual(["full"]);
    expect(timeline.calls).toEqual(["progress(1)", "kill"]);
  });

  it("completes at once when the level drops mid-flight", async () => {
    const { timeline, policy, load, sequence } = setup("full");
    const run = runTimeline({ load, sequence, policy });
    await timeline.started;
    policy.set("reduced");

    expect(await run).toBe("cut");
    expect(timeline.calls).toEqual(["play", "progress(1)", "kill"]);
    expect(policy.listenerCount()).toBe(0);
  });

  it("keeps playing when the level does not drop", async () => {
    const { timeline, policy, load, sequence } = setup("reduced");
    const run = runTimeline({ load, sequence, policy });
    await timeline.started;
    policy.set("full");
    timeline.complete();

    expect(await run).toBe("played");
    expect(timeline.calls).toEqual(["play"]);
  });

  it("cuts to the end state when the caller aborts mid-flight", async () => {
    const { timeline, policy, load, sequence } = setup("full");
    const abort = new AbortController();
    const run = runTimeline({ load, sequence, policy, signal: abort.signal });
    await timeline.started;
    abort.abort();

    expect(await run).toBe("cut");
    expect(timeline.calls).toEqual(["play", "progress(1)", "kill"]);
  });

  it("applies the end state without playing when the engine arrives after the data", async () => {
    const { timeline, policy, sequence } = setup("full");
    let deliver!: (engine: { createTimeline: () => FakeTimeline }) => void;
    const engine = new Promise<{ createTimeline: () => FakeTimeline }>((done) => (deliver = done));
    const abort = new AbortController();
    const run = runTimeline({ load: () => engine, sequence, policy, signal: abort.signal });

    abort.abort();
    deliver({ createTimeline: () => timeline });

    expect(await run).toBe("cut");
    expect(timeline.calls).toEqual(["progress(1)", "kill"]);
  });

  it("reports an engine that failed to load, so the caller keeps its static end state", async () => {
    const { policy, sequence } = setup("full");
    const run = runTimeline({
      load: () => Promise.reject(new Error("chunk failed")),
      sequence,
      policy,
    });

    expect(await run).toBe("unavailable");
    expect(policy.listenerCount()).toBe(0);
  });
});
