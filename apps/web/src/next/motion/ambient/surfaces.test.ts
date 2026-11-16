import { describe, expect, it } from "vite-plus/test";

import { claimAmbientCanvas, decideAmbient } from "./surfaces.ts";

describe("ambient gate", () => {
  it("runs live only at Full, on an allowed surface, on a pointer device", () => {
    expect(decideAmbient({ level: "full", surface: "welcome", touchFirst: false })).toEqual({
      live: true,
    });
    expect(decideAmbient({ level: "full", surface: "pairing", touchFirst: false })).toEqual({
      live: true,
    });
  });

  it.each([
    [{ level: "reduced", surface: "welcome", touchFirst: false }, "reduced"],
    [{ level: "off", surface: "pairing", touchFirst: false }, "off"],
    [{ level: "full", surface: "welcome", touchFirst: true }, "touch-first"],
    [{ level: "full", surface: "zero-projects", touchFirst: false }, "surface-refused"],
    [{ level: "full", surface: "thread", touchFirst: false }, "surface-refused"],
  ] as const)("shows the static gradient for %o", (input, reason) => {
    expect(decideAmbient(input)).toEqual({ live: false, reason });
  });
});

describe("one canvas per window", () => {
  it("gives the canvas to the first surface until it releases", () => {
    const first = claimAmbientCanvas();
    expect(first).not.toBeNull();
    expect(claimAmbientCanvas()).toBeNull();
    first!();
    const second = claimAmbientCanvas();
    expect(second).not.toBeNull();
    // A stale release from the first owner does not free the second's canvas.
    first!();
    expect(claimAmbientCanvas()).toBeNull();
    second!();
  });
});
