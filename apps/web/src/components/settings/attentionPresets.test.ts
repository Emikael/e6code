import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { ATTENTION_PRESETS, resolveAttentionPreset } from "./attentionPresets";

describe("resolveAttentionPreset", () => {
  it("reads the defaults as Standard", () => {
    expect(resolveAttentionPreset(DEFAULT_CLIENT_SETTINGS)).toBe("standard");
  });

  it("maps each starting point's values back to its tile", () => {
    expect(resolveAttentionPreset({ ...DEFAULT_CLIENT_SETTINGS, ...ATTENTION_PRESETS.quiet })).toBe(
      "quiet",
    );
    expect(
      resolveAttentionPreset({ ...DEFAULT_CLIENT_SETTINGS, ...ATTENTION_PRESETS.detailed }),
    ).toBe("detailed");
  });

  it("selects no tile once one of its controls changes", () => {
    expect(
      resolveAttentionPreset({ ...DEFAULT_CLIENT_SETTINGS, attentionSoundEnabled: true }),
    ).toBeNull();
    expect(
      resolveAttentionPreset({
        ...DEFAULT_CLIENT_SETTINGS,
        ...ATTENTION_PRESETS.detailed,
        composerControls: "compact",
      }),
    ).toBeNull();
  });

  it("ignores controls a starting point leaves alone", () => {
    expect(
      resolveAttentionPreset({
        ...DEFAULT_CLIENT_SETTINGS,
        recapTrigger: "never",
        sessionClockEnabled: true,
      }),
    ).toBe("standard");
  });
});
