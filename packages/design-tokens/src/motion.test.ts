import { describe, expect, it } from "vite-plus/test";

import { SPRING, SPRING_CURVE, springPosition } from "./motion.ts";

const curvePoints = (linear: string) => linear.slice("linear(".length, -1).split(", ").map(Number);

describe("spring linear() curves", () => {
  it("start at rest and end on the target", () => {
    for (const { linear } of Object.values(SPRING_CURVE)) {
      const points = curvePoints(linear);
      expect(points[0]).toBe(0);
      expect(points.at(-1)).toBe(1);
    }
  });

  it("never overshoot without bounce, and overshoot with it", () => {
    expect(Math.max(...curvePoints(SPRING_CURVE.gentle.linear))).toBe(1);
    expect(Math.max(...curvePoints(SPRING_CURVE.snappy.linear))).toBeGreaterThan(1);
  });

  it("last until the spring has settled, longer than its visual duration", () => {
    for (const [name, spring] of Object.entries(SPRING)) {
      const { durationMs } = SPRING_CURVE[name as keyof typeof SPRING];
      expect(durationMs).toBeGreaterThan(spring.duration);
      expect(Math.abs(1 - springPosition(spring, durationMs / 1000))).toBeLessThanOrEqual(0.001);
    }
  });
});
