import type { MotionLevel } from "@e6tools/client-runtime/motion-level";
import { describe, expect, it } from "vite-plus/test";

import { STAGGER } from "../tokens.ts";
import { COPY_CONFIRM_HOLD_MS, createCopyConfirm } from "./copyConfirm.ts";
import { depthDirection } from "./direction.ts";
import { finishRunningAnimations } from "./finishOnCommit.ts";
import { staggerDelayMs } from "./stagger.ts";
import { createStreamingPriority } from "./streamingPriority.ts";
import { createViewportTracker } from "./viewport.ts";

describe("staggerDelayMs", () => {
  it("steps per item and caps at the eighth", () => {
    const delays = Array.from({ length: 12 }, (_, index) =>
      staggerDelayMs(index, { level: "full" }),
    );
    expect(delays.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * STAGGER.step));
    expect(new Set(delays.slice(7))).toEqual(new Set([7 * STAGGER.step]));
  });

  it("is instant below Full, while streaming and off screen", () => {
    expect(staggerDelayMs(5, { level: "reduced" })).toBe(0);
    expect(staggerDelayMs(5, { level: "off" })).toBe(0);
    expect(staggerDelayMs(5, { level: "full", streaming: true })).toBe(0);
    expect(staggerDelayMs(5, { level: "full", inViewport: false })).toBe(0);
  });
});

describe("depthDirection", () => {
  it("goes forward deeper, back up, and cuts between peers", () => {
    expect(depthDirection(0, 1)).toBe("forward");
    expect(depthDirection(2, 1)).toBe("back");
    expect(depthDirection(1, 1)).toBeNull();
  });
});

describe("finishRunningAnimations", () => {
  it("ends every running animation in the subtree", () => {
    const finished: number[] = [];
    const subtree = {
      getAnimations: () => [0, 1, 2].map((id) => ({ finish: () => void finished.push(id) })),
    };
    expect(finishRunningAnimations(subtree)).toBe(3);
    expect(finished).toEqual([0, 1, 2]);
  });

  it("keeps going past an animation that cannot finish", () => {
    const finished: number[] = [];
    const subtree = {
      getAnimations: () => [
        {
          finish: () => {
            throw new Error("infinite");
          },
        },
        { finish: () => void finished.push(1) },
      ],
    };
    finishRunningAnimations(subtree);
    expect(finished).toEqual([1]);
  });
});

describe("createViewportTracker", () => {
  const fakeObserver = () => {
    const state = {
      created: 0,
      disconnected: 0,
      observed: new Set<object>(),
      report: (_entries: ReadonlyArray<{ target: Element; isIntersecting: boolean }>) => {},
    };
    const create = (callback: typeof state.report) => {
      state.created++;
      state.report = callback;
      return {
        observe: (target: Element) => void state.observed.add(target),
        unobserve: (target: Element) => void state.observed.delete(target),
        disconnect: () => void state.disconnected++,
      };
    };
    return { state, create };
  };

  it("shares one observer and tears it down after the last element", () => {
    const { state, create } = fakeObserver();
    const tracker = createViewportTracker(create);
    const [a, b] = [{} as Element, {} as Element];
    const seen: Array<[string, boolean]> = [];
    const stopA = tracker.watch(a, (inView) => seen.push(["a", inView]));
    const stopB = tracker.watch(b, (inView) => seen.push(["b", inView]));
    expect(state.created).toBe(1);

    state.report([
      { target: a, isIntersecting: false },
      { target: b, isIntersecting: true },
    ]);
    expect(seen).toEqual([
      ["a", false],
      ["b", true],
    ]);

    stopA();
    expect(state.disconnected).toBe(0);
    stopB();
    expect(state.disconnected).toBe(1);
    expect(tracker.watchedCount()).toBe(0);

    tracker.watch(a, () => undefined);
    expect(state.created).toBe(2);
  });

  it("reports nothing without IntersectionObserver", () => {
    const tracker = createViewportTracker(undefined);
    tracker.watch({} as Element, () => undefined)();
    expect(tracker.watchedCount()).toBe(0);
  });
});

describe("streaming priority", () => {
  it("stops decorative motion while the focused thread streams, and only then", () => {
    let level: MotionLevel = "full";
    const priority = createStreamingPriority({ getLevel: () => level });
    let notified = 0;
    priority.subscribe(() => notified++);

    expect(priority.allowsDecorativeMotion()).toBe(true);
    priority.setFocusedThreadStreaming(true);
    expect(priority.allowsDecorativeMotion()).toBe(false);
    priority.setFocusedThreadStreaming(true);
    expect(notified).toBe(1);
    priority.setFocusedThreadStreaming(false);
    expect(priority.allowsDecorativeMotion()).toBe(true);

    level = "reduced";
    expect(priority.allowsDecorativeMotion()).toBe(false);
  });
});

describe("copy confirmation", () => {
  const fakeClock = () => {
    let now = 0;
    let timers: Array<{ id: number; at: number; callback: () => void }> = [];
    let nextId = 0;
    return {
      setTimeout: (callback: () => void, ms: number) => {
        timers.push({ id: ++nextId, at: now + ms, callback });
        return nextId;
      },
      clearTimeout: (id: unknown) => {
        timers = timers.filter((timer) => timer.id !== id);
      },
      advance(ms: number) {
        now += ms;
        const due = timers.filter((timer) => timer.at <= now);
        timers = timers.filter((timer) => timer.at > now);
        for (const timer of due) timer.callback();
      },
    };
  };

  it("holds the check, then reverts", () => {
    const clock = fakeClock();
    const states: boolean[] = [];
    const copy = createCopyConfirm((copied) => states.push(copied), clock);
    copy.confirm();
    clock.advance(COPY_CONFIRM_HOLD_MS - 1);
    expect(states).toEqual([true]);
    clock.advance(1);
    expect(states).toEqual([true, false]);
  });

  it("restarts the hold when copied again", () => {
    const clock = fakeClock();
    const states: boolean[] = [];
    const copy = createCopyConfirm((copied) => states.push(copied), clock);
    copy.confirm();
    clock.advance(COPY_CONFIRM_HOLD_MS - 100);
    copy.confirm();
    clock.advance(COPY_CONFIRM_HOLD_MS - 1);
    expect(states).toEqual([true]);
    clock.advance(1);
    expect(states).toEqual([true, false]);
  });
});
