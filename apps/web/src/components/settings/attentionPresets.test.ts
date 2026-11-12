import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import {
  ATTENTION_PRESETS,
  presetSideEffects,
  presetUndoValues,
  resolveAttentionPreset,
} from "./attentionPresets";

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

describe("choosing a starting point", () => {
  it("keeps exactly the values it overwrites, so Undo restores them", () => {
    const before = {
      ...DEFAULT_CLIENT_SETTINGS,
      attentionSoundEnabled: true,
      recapTrigger: "never" as const,
    };
    const undo = presetUndoValues(before);
    expect(Object.keys(undo).toSorted()).toEqual(Object.keys(ATTENTION_PRESETS.quiet).toSorted());
    expect(undo.attentionSoundEnabled).toBe(true);
    expect(
      resolveAttentionPreset({ ...before, ...ATTENTION_PRESETS.detailed, ...undo }),
    ).toBeNull();
  });

  it("asks for notification permission and unlocks audio when Detailed turns them on", () => {
    const standard = presetUndoValues(DEFAULT_CLIENT_SETTINGS);
    expect(presetSideEffects(standard, "detailed")).toEqual({
      requestNotifications: true,
      unlockAudio: true,
    });
    expect(
      presetSideEffects(
        presetUndoValues({ ...DEFAULT_CLIENT_SETTINGS, ...ATTENTION_PRESETS.detailed }),
        "quiet",
      ),
    ).toEqual({
      requestNotifications: true,
      unlockAudio: false,
    });
    expect(presetSideEffects(standard, "quiet")).toEqual({
      requestNotifications: false,
      unlockAudio: false,
    });
  });
});
