import { describe, expect, it } from "vite-plus/test";

import { motionPreferenceForKey, motionResolutionLine } from "./MotionSettingRow.logic";

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
