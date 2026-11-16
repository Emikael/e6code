import type { MotionLevel } from "@e6tools/client-runtime/motion-level";
import { describe, expect, it } from "vite-plus/test";

import type { AnimateDriver, RunningAnimation } from "../choreography/retarget.ts";
import { createOneShots } from "./oneShot.ts";

/** A driver that records each run and lets the test settle or interrupt it. */
const fakeDriver = () => {
  const runs: Array<{
    keyframes: Record<string, Array<string | number | null>>;
    stopped: boolean;
    completed: boolean;
    settle: () => void;
  }> = [];
  const driver: AnimateDriver<object> = (_target, keyframes) => {
    let settle = () => {};
    const finished = new Promise<void>((resolve) => (settle = resolve));
    const run = { keyframes, stopped: false, completed: false, settle };
    runs.push(run);
    const animation: RunningAnimation = {
      stop: () => {
        run.stopped = true;
        settle();
      },
      complete: () => {
        run.completed = true;
        settle();
      },
      finished,
    };
    return animation;
  };
  return { runs, driver };
};

describe("shake", () => {
  it("does nothing at Reduced and Off", () => {
    for (const level of ["reduced", "off"] as const) {
      const { runs, driver } = fakeDriver();
      const shots = createOneShots(driver, () => level);
      expect(shots.shake({})).toBe(false);
      expect(runs).toHaveLength(0);
    }
  });

  it("moves by transform only and ends at rest", () => {
    const { runs, driver } = fakeDriver();
    createOneShots(driver, () => "full").shake({});
    expect(Object.keys(runs[0]!.keyframes)).toEqual(["transform"]);
    expect(runs[0]!.keyframes.transform!.at(-1)).toBe("translateX(0px)");
  });

  it("retargets from where it is when rejected again mid-shake", async () => {
    const { runs, driver } = fakeDriver();
    let level: MotionLevel = "full";
    const shots = createOneShots(driver, () => level);
    const field = {};
    for (let i = 0; i < 5; i++) shots.shake(field);

    expect(runs).toHaveLength(5);
    // Every earlier run was stopped where it was; only the newest is live.
    expect(runs.slice(0, 4).every((run) => run.stopped)).toBe(true);
    expect(runs[4]!.stopped).toBe(false);
    // Each run starts from the computed value, not from a fixed first frame.
    expect(runs.every((run) => run.keyframes.transform![0] === null)).toBe(true);

    // Data beats animation: finishing jumps the live run to its end.
    shots.finish(field);
    expect(runs[4]!.completed).toBe(true);

    level = "off";
    expect(shots.shake(field)).toBe(false);
    expect(runs).toHaveLength(5);
  });
});
