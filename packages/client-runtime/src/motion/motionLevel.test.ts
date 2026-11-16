import { describe, expect, it } from "vite-plus/test";

import {
  activeMotionConstraints,
  describeMotionResolution,
  type MotionConstraints,
  type MotionPreference,
  resolveMotionLevel,
} from "./motionLevel.ts";

const UNCONSTRAINED: MotionConstraints = {
  prefersReducedMotion: false,
  onBattery: null,
  thermalState: "unknown",
  deviceMemoryGb: null,
};

const CONSTRAINTS: ReadonlyArray<[string, Partial<MotionConstraints>]> = [
  ["OS reduced motion", { prefersReducedMotion: true }],
  ["running on battery", { onBattery: true }],
  ["serious thermal pressure", { thermalState: "serious" }],
  ["critical thermal pressure", { thermalState: "critical" }],
  ["4 GB of memory", { deviceMemoryGb: 4 }],
  ["2 GB of memory", { deviceMemoryGb: 2 }],
];

const NOT_CONSTRAINTS: ReadonlyArray<[string, Partial<MotionConstraints>]> = [
  ["mains power", { onBattery: false }],
  ["nominal thermal state", { thermalState: "nominal" }],
  ["fair thermal state", { thermalState: "fair" }],
  ["8 GB of memory", { deviceMemoryGb: 8 }],
];

describe("resolveMotionLevel", () => {
  it("follows the system at Full when nothing constrains the device", () => {
    expect(resolveMotionLevel("system", UNCONSTRAINED)).toBe("full");
    expect(resolveMotionLevel(undefined, UNCONSTRAINED)).toBe("full");
  });

  it.each(CONSTRAINTS)("drops Follow system to Reduced under %s", (_name, constraint) => {
    expect(resolveMotionLevel("system", { ...UNCONSTRAINED, ...constraint })).toBe("reduced");
  });

  it.each(NOT_CONSTRAINTS)("keeps Follow system at Full on %s", (_name, input) => {
    expect(resolveMotionLevel("system", { ...UNCONSTRAINED, ...input })).toBe("full");
  });

  it("never reaches Off on its own", () => {
    const everything: MotionConstraints = {
      prefersReducedMotion: true,
      onBattery: true,
      thermalState: "critical",
      deviceMemoryGb: 1,
    };
    expect(resolveMotionLevel("system", everything)).toBe("reduced");
  });

  it.each<[MotionPreference, string]>([
    ["full", "full"],
    ["reduced", "reduced"],
    ["off", "off"],
  ])("treats an explicit %s as final under every constraint", (preference, expected) => {
    expect(resolveMotionLevel(preference, UNCONSTRAINED)).toBe(expected);
    for (const [, constraint] of CONSTRAINTS) {
      expect(resolveMotionLevel(preference, { ...UNCONSTRAINED, ...constraint })).toBe(expected);
    }
  });
});

describe("activeMotionConstraints", () => {
  it("lists every constraint that holds, in display order", () => {
    expect(
      activeMotionConstraints({
        prefersReducedMotion: true,
        onBattery: true,
        thermalState: "critical",
        deviceMemoryGb: 2,
      }),
    ).toEqual(["reduced-motion", "battery", "thermal", "memory"]);
    expect(activeMotionConstraints(UNCONSTRAINED)).toEqual([]);
  });
});

describe("describeMotionResolution", () => {
  it("says Follow system resolved to Full when nothing constrains the device", () => {
    expect(describeMotionResolution("system", [])).toBe("Following system: Full");
  });

  it("names every reason Follow system dropped to Reduced", () => {
    expect(describeMotionResolution("system", ["battery"])).toBe(
      "Following system: Reduced, on battery",
    );
    expect(describeMotionResolution("system", ["battery", "thermal"])).toBe(
      "Following system: Reduced, on battery and running hot",
    );
    expect(describeMotionResolution("system", ["reduced-motion", "battery", "memory"])).toBe(
      "Following system: Reduced, reduced motion is on, on battery and low memory",
    );
  });

  it("explains an explicit Full only while the device asks for less", () => {
    expect(describeMotionResolution("full", [])).toBeNull();
    expect(describeMotionResolution("full", ["thermal"])).toBe(
      "Full, even though your device reports running hot",
    );
  });

  it("has nothing to say for an explicit Reduced or Off", () => {
    expect(describeMotionResolution("reduced", ["battery"])).toBeNull();
    expect(describeMotionResolution("off", [])).toBeNull();
  });
});
