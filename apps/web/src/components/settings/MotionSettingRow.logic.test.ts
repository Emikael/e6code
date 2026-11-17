import { describe, expect, it } from "vite-plus/test";

import type { MotionPreference } from "@e6tools/client-runtime/motion-level";

import {
  handleMotionHomeEnd,
  motionPreferenceForKey,
  motionResolutionLine,
} from "./MotionSettingRow.logic";

const recordActions = () => {
  const calls: Array<[string, MotionPreference]> = [];
  return {
    calls,
    actions: {
      focus: (preference: MotionPreference) => void calls.push(["focus", preference]),
      select: (preference: MotionPreference) => void calls.push(["select", preference]),
    },
  };
};

describe("handleMotionHomeEnd", () => {
  it("focuses and selects the last level on End", () => {
    const { calls, actions } = recordActions();
    expect(handleMotionHomeEnd("End", "full", actions)).toBe(true);
    expect(calls).toEqual([
      ["focus", "off"],
      ["select", "off"],
    ]);
  });

  it("only moves focus when Home lands on the level already chosen", () => {
    const { calls, actions } = recordActions();
    expect(handleMotionHomeEnd("Home", "system", actions)).toBe(true);
    expect(calls).toEqual([["focus", "system"]]);
  });

  it("leaves other keys alone so the browser and the radio group handle them", () => {
    const { calls, actions } = recordActions();
    expect(handleMotionHomeEnd("ArrowLeft", "full", actions)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("motionResolutionLine", () => {
  it("names Reduced and its reason when the device constrains Follow system", () => {
    expect(
      motionResolutionLine({ preference: "system", level: "reduced", reasons: ["battery"] }),
    ).toEqual({ text: "Following system: Reduced, on battery", level: "reduced" });
  });

  it("explains an explicit Full under a constraint with the Full icon", () => {
    expect(
      motionResolutionLine({ preference: "full", level: "full", reasons: ["thermal"] }),
    ).toEqual({ text: "Full, even though your device reports running hot", level: "full" });
  });

  it("shows nothing for an explicit Off, whatever the device reports", () => {
    expect(
      motionResolutionLine({ preference: "off", level: "off", reasons: ["battery"] }),
    ).toBeNull();
  });
});

describe("motionPreferenceForKey", () => {
  it("jumps to the first level on Home and the last on End", () => {
    expect(motionPreferenceForKey("Home")).toBe("system");
    expect(motionPreferenceForKey("End")).toBe("off");
  });

  it("leaves arrows and other keys to the radio group", () => {
    expect(motionPreferenceForKey("ArrowRight")).toBeNull();
    expect(motionPreferenceForKey("Tab")).toBeNull();
  });
});
