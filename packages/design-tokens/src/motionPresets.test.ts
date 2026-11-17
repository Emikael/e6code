import { describe, expect, it } from "vite-plus/test";

import { MOTION_PRESET_TOKENS } from "./motionPresets.ts";

const declarations = Object.fromEntries(
  MOTION_PRESET_TOKENS.body.filter((node) => Array.isArray(node)) as [string, string][],
);

describe("motion preset tokens", () => {
  it("carry travel in px and scale factors unitless", () => {
    expect(declarations).toMatchObject({
      "--distance-reveal": "6px",
      "--distance-shake": "4px",
      "--distance-dolly": "24px",
      "--distance-scale-from": "0.96",
      "--distance-icon-scale-from": "0.6",
      "--distance-dialog-scale-from": "0.98",
    });
  });

  it("carry each spring as a linear() curve with its own duration", () => {
    for (const name of ["snappy", "gentle", "drop"]) {
      expect(declarations[`--spring-${name}`]).toMatch(/^linear\(0, .*, 1\)$/);
      expect(declarations[`--spring-${name}-dur`]).toMatch(/^\d+ms$/);
    }
    // Never the legacy names, which `installMotionTokens` writes inline on :root.
    expect(Object.keys(declarations).some((name) => name.startsWith("--ease-spring"))).toBe(false);
  });

  it("carry the skeleton breath", () => {
    expect(declarations).toMatchObject({
      "--skeleton-dur": "840ms",
      "--skeleton-steps": "6",
      "--skeleton-floor": "0.6",
    });
  });
});
