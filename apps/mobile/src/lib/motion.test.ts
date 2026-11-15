import { describe, expect, it } from "vite-plus/test";

import { MOTION_SPRING } from "./motion";

describe("MOTION_SPRING", () => {
  it("turns each spring's bounce into a Reanimated damping ratio", () => {
    expect(MOTION_SPRING).toEqual({
      snappy: { duration: 260, dampingRatio: 0.88 },
      gentle: { duration: 380, dampingRatio: 1 },
      drop: { duration: 200, dampingRatio: 0.92 },
    });
  });
});
