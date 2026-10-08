import { describe, expect, it } from "vite-plus/test";

import { QUIT_HOLD_DURATION_MS } from "@e6tools/contracts";

import { quitHoldFillMotion, scaleXFromTransform } from "./QuitHoldOverlay.logic";

describe("scaleXFromTransform", () => {
  it("reads the X scale from a computed matrix or scaleX value", () => {
    expect(scaleXFromTransform("none")).toBe(0);
    expect(scaleXFromTransform("")).toBe(0);
    expect(scaleXFromTransform("matrix(0.4, 0, 0, 1, 0, 0)")).toBeCloseTo(0.4);
    expect(
      scaleXFromTransform("matrix3d(0.55, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"),
    ).toBeCloseTo(0.55);
    expect(scaleXFromTransform("scaleX(0.25)")).toBeCloseTo(0.25);
  });
});

describe("quitHoldFillMotion", () => {
  it("fills from empty to full across the desktop hold", () => {
    expect(
      quitHoldFillMotion({
        holding: true,
        reducedMotion: false,
        currentScale: 0.2,
        holdDurationMs: QUIT_HOLD_DURATION_MS,
      }),
    ).toEqual({ kind: "fill", from: 0, to: 1, duration: QUIT_HOLD_DURATION_MS });
  });

  it("drains from the scale already reached", () => {
    expect(
      quitHoldFillMotion({
        holding: false,
        reducedMotion: false,
        currentScale: 0.35,
        holdDurationMs: QUIT_HOLD_DURATION_MS,
      }),
    ).toEqual({ kind: "drain", from: 0.35, to: 0, duration: 200 });
  });

  it("freezes at the current scale when reduced motion is on", () => {
    expect(
      quitHoldFillMotion({
        holding: true,
        reducedMotion: true,
        currentScale: 0.6,
        holdDurationMs: QUIT_HOLD_DURATION_MS,
      }),
    ).toEqual({ kind: "freeze", scale: 0.6 });
    expect(
      quitHoldFillMotion({
        holding: false,
        reducedMotion: true,
        currentScale: 0.6,
        holdDurationMs: QUIT_HOLD_DURATION_MS,
      }),
    ).toEqual({ kind: "freeze", scale: 0.6 });
  });
});
