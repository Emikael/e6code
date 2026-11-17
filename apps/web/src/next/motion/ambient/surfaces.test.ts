import { describeAmbientState } from "@e6tools/shared/ambientLightState";
import { describe, expect, it } from "vite-plus/test";

import { type AmbientClaim, claimAmbientCanvas, decideAmbient } from "./surfaces.ts";

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
  ] as const)("shows the static gradient for %o", (input, reason) => {
    expect(decideAmbient(input)).toEqual({ live: false, reason });
  });

  it.each(["zero-projects", "thread"])("refuses %s and names it in the readout", (surface) => {
    const gate = decideAmbient({ level: "full", surface, touchFirst: false });
    expect(gate).toEqual({ live: false, reason: "surface-refused", detail: surface });
    expect(
      describeAmbientState({ kind: "static", reason: "surface-refused", detail: surface }),
    ).toBe(`Refused: ${surface} is not an allowed surface, it keeps the static gradient`);
  });
});

const release = (claim: AmbientClaim) => {
  if (!("release" in claim)) throw new Error(`held by ${claim.heldBy}`);
  return claim.release;
};

describe("one canvas per window", () => {
  it("gives the canvas to the first surface and names it to the second", () => {
    const first = release(claimAmbientCanvas("welcome"));
    expect(claimAmbientCanvas("pairing")).toEqual({ heldBy: "Welcome" });
    first();
    const second = release(claimAmbientCanvas("pairing"));
    // A stale release from the first owner does not free the second's canvas.
    first();
    expect(claimAmbientCanvas("welcome")).toEqual({ heldBy: "Pairing" });
    second();
  });
});
