import { describe, expect, it } from "vite-plus/test";

import { allowsViewTransitions, motionConfigFor } from "./motionConfig.ts";
import { DUR_S } from "./tokens.ts";

describe("motionConfigFor", () => {
  it("plays everything at Full and never defers to the engine's own media query", () => {
    expect(motionConfigFor("full")).toEqual({ reducedMotion: "never" });
  });

  it("keeps Reduced to short fades: no transforms, 150 ms default", () => {
    expect(motionConfigFor("reduced")).toEqual({
      reducedMotion: "always",
      transition: { duration: 0.15 },
    });
  });

  it("changes state instantly at Off", () => {
    expect(motionConfigFor("off")).toEqual({
      reducedMotion: "always",
      transition: { duration: 0 },
    });
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
    expect(DUR_S).toMatchObject({ instant: 0, quick: 0.14, scene: 0.42, reduced: 0.15 });
  });
});
