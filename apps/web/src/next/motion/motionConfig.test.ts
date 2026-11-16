import { describe, expect, it } from "vite-plus/test";

import { allowsViewTransitions, motionConfigFor } from "./motionConfig.ts";
import { DUR_S } from "./tokens.ts";

/** The ENG-114 ceiling for a Reduced fade. */
const REDUCED_CEILING_S = 0.15;

describe("motionConfigFor", () => {
  it("lets Full play transforms and keeps each preset's own timing", () => {
    const config = motionConfigFor("full");
    expect(config.reducedMotion).toBe("never");
    expect(config.transition).toBeUndefined();
  });

  it("drops transforms at Reduced and caps the default fade at the Reduced ceiling", () => {
    const config = motionConfigFor("reduced");
    expect(config.reducedMotion).toBe("always");
    expect(config.transition?.duration).toBeGreaterThan(0);
    expect(config.transition?.duration).toBeLessThanOrEqual(REDUCED_CEILING_S);
  });

  it("drops transforms and plays no frames by default at Off", () => {
    const config = motionConfigFor("off");
    expect(config.reducedMotion).toBe("always");
    expect(config.transition?.duration).toBe(0);
  });

  it("never hands the decision back to the engine's own media query", () => {
    for (const level of ["full", "reduced", "off"] as const) {
      expect(motionConfigFor(level).reducedMotion).not.toBe("user");
    }
  });
});

describe("allowsViewTransitions", () => {
  it("allows view transitions only at Full", () => {
    expect(
      ["full", "reduced", "off"].map((level) => allowsViewTransitions(level as never)),
    ).toEqual([true, false, false]);
  });
});

describe("DUR_S", () => {
  it("gives the engine the token durations in seconds", () => {
    expect(DUR_S).toMatchObject({ instant: 0, quick: 0.14, scene: 0.42 });
  });
});
