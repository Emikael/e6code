/**
 * The Attention page's starting points (F13, board 6). A starting point sets
 * six controls at once; everything else on the page is untouched. The tile
 * shown as selected is derived from the current values, so changing one
 * control afterwards leaves no tile selected.
 */
import type { ClientSettings } from "@e6tools/contracts/settings";

export type AttentionPreset = "quiet" | "standard" | "detailed";

type PresetValues = Pick<
  ClientSettings,
  | "attentionNotifications"
  | "notifyWatchedThreads"
  | "attentionSoundEnabled"
  | "agentActivityDetail"
  | "composerControls"
  | "holdFinishedUntilBreakpoint"
>;

export const ATTENTION_PRESETS: Readonly<Record<AttentionPreset, PresetValues>> = {
  quiet: {
    attentionNotifications: "blocked",
    notifyWatchedThreads: false,
    attentionSoundEnabled: false,
    agentActivityDetail: "summary",
    composerControls: "compact",
    holdFinishedUntilBreakpoint: true,
  },
  standard: {
    attentionNotifications: "blocked",
    notifyWatchedThreads: true,
    attentionSoundEnabled: false,
    agentActivityDetail: "summary",
    composerControls: "compact",
    holdFinishedUntilBreakpoint: true,
  },
  detailed: {
    attentionNotifications: "all",
    notifyWatchedThreads: true,
    attentionSoundEnabled: true,
    agentActivityDetail: "live",
    composerControls: "full",
    holdFinishedUntilBreakpoint: false,
  },
};

export const ATTENTION_PRESET_ORDER: ReadonlyArray<AttentionPreset> = [
  "quiet",
  "standard",
  "detailed",
];

/** The starting point the current values match, or null when they match none. */
export function resolveAttentionPreset<T extends PresetValues>(
  settings: T,
): AttentionPreset | null {
  for (const preset of ATTENTION_PRESET_ORDER) {
    const values = ATTENTION_PRESETS[preset];
    if (
      (Object.keys(values) as Array<keyof PresetValues>).every(
        (key) => settings[key] === values[key],
      )
    ) {
      return preset;
    }
  }
  return null;
}

/** The current values a starting point would overwrite, kept for its Undo. */
export function presetUndoValues<T extends PresetValues>(settings: T): PresetValues {
  const values = {} as Record<keyof PresetValues, unknown>;
  for (const key of Object.keys(ATTENTION_PRESETS.standard) as Array<keyof PresetValues>) {
    values[key] = settings[key];
  }
  return values as PresetValues;
}

/**
 * What choosing a starting point must also ask the browser for, the same as the
 * individual controls do: notification permission when it turns notifications
 * on, and an audio unlock (inside the click) when it turns sound on.
 */
export function presetSideEffects(
  previous: PresetValues,
  preset: AttentionPreset,
): { requestNotifications: boolean; unlockAudio: boolean } {
  const next = ATTENTION_PRESETS[preset];
  return {
    requestNotifications:
      next.attentionNotifications !== "off" &&
      previous.attentionNotifications !== next.attentionNotifications,
    unlockAudio: next.attentionSoundEnabled && !previous.attentionSoundEnabled,
  };
}
