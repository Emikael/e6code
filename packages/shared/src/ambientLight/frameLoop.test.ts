import { describe, expect, it } from "vite-plus/test";

import { AMBIENT_IDLE_MS, createFrameLoop } from "./frameLoop.ts";
import { createFakeClock } from "./testing.ts";

const setup = () => {
  const fake = createFakeClock();
  const drawnAt: number[] = [];
  const lightTimes: number[] = [];
  const loop = createFrameLoop({
    clock: fake.clock,
    draw: (time) => {
      drawnAt.push(fake.now());
      lightTimes.push(time);
      return true;
    },
    onChange: () => undefined,
  });
  return { fake, loop, drawnAt, lightTimes };
};

describe("ambient frame loop", () => {
  it.each([60, 120, 144, 240])("draws at most 31 times a second at %i Hz", (hz) => {
    const { fake, drawnAt } = setup();
    fake.run(1000, hz);
    const lastSecond = drawnAt.length;
    fake.run(1000, hz);
    expect(drawnAt.length - lastSecond).toBeLessThanOrEqual(31);
    expect(drawnAt.length - lastSecond).toBeGreaterThanOrEqual(29);
  });

  it("rests exactly at 10 s without input, with no frame left pending", () => {
    const { fake, loop } = setup();
    fake.run(AMBIENT_IDLE_MS - 50);
    expect(fake.pendingFrames()).toBe(1);
    fake.run(100);
    expect(fake.pendingFrames()).toBe(0);
    expect(loop.isRunning()).toBe(false);
    expect(loop.pauseReasons()).toEqual(["idle"]);
  });

  it("wakes on input and continues from the frozen time without a jump", () => {
    const { fake, loop, lightTimes } = setup();
    fake.run(AMBIENT_IDLE_MS + 100);
    const frozen = lightTimes.at(-1)!;
    fake.run(60_000);
    expect(lightTimes.at(-1)).toBe(frozen);

    loop.input();
    expect(loop.pauseReasons()).toEqual([]);
    fake.run(20);
    expect(lightTimes.at(-1)).toBe(frozen);
    fake.run(1000);
    expect(lightTimes.at(-1)! - frozen).toBeLessThan(1050);
  });

  it("input keeps a running loop awake past 10 s", () => {
    const { fake, loop } = setup();
    fake.run(8000);
    loop.input();
    fake.run(8000);
    expect(loop.isRunning()).toBe(true);
  });

  it.each(["hidden", "blurred", "offscreen", "streaming"] as const)(
    "stops every frame while %s and resumes from the same time",
    (reason) => {
      const { fake, loop, lightTimes, drawnAt } = setup();
      fake.run(500);
      loop.setPaused(reason, true);
      expect(fake.pendingFrames()).toBe(0);
      const draws = drawnAt.length;
      const frozen = lightTimes.at(-1)!;
      fake.run(5000);
      expect(drawnAt.length).toBe(draws);

      loop.input();
      loop.setPaused(reason, false);
      expect(fake.pendingFrames()).toBe(1);
      fake.run(20);
      expect(lightTimes.at(-1)).toBe(frozen);
    },
  );

  it("stays paused until the last reason clears", () => {
    const { fake, loop } = setup();
    loop.setPaused("hidden", true);
    loop.setPaused("streaming", true);
    loop.setPaused("hidden", false);
    expect(fake.pendingFrames()).toBe(0);
    loop.setPaused("streaming", false);
    expect(fake.pendingFrames()).toBe(1);
  });

  it("draws one frame on demand while paused without restarting", () => {
    const { fake, loop, drawnAt, lightTimes } = setup();
    fake.run(300);
    loop.setPaused("blurred", true);
    const before = drawnAt.length;
    loop.drawNow();
    expect(drawnAt.length).toBe(before + 1);
    expect(lightTimes.at(-1)).toBe(lightTimes.at(-2));
    expect(fake.pendingFrames()).toBe(0);
  });

  it("does not advance time on frames where nothing was drawn", () => {
    const fake = createFakeClock();
    let ready = false;
    const times: number[] = [];
    createFrameLoop({
      clock: fake.clock,
      draw: (time) => {
        if (!ready) return false;
        times.push(time);
        return true;
      },
      onChange: () => undefined,
    });
    fake.run(2000);
    ready = true;
    fake.run(40);
    expect(times[0]).toBeLessThan(100);
  });

  it("cancels its frame on destroy", () => {
    const { fake, loop } = setup();
    loop.destroy();
    expect(fake.pendingFrames()).toBe(0);
    loop.setPaused("hidden", true);
    loop.setPaused("hidden", false);
    expect(fake.pendingFrames()).toBe(0);
  });
});
