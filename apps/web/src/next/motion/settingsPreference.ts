import { getClientSettings, subscribeClientSettings } from "~/hooks/useSettings";

import type { MotionPreferenceSource } from "./policy.ts";

/**
 * The Motion setting as MotionPolicy reads it. Before client settings hydrate, and when the
 * read fails, the snapshot holds the schema default, Follow system (ENG-126). Saved settings
 * replace the snapshot and notify settings listeners, which is the only change that matters.
 */
export const clientSettingsMotionPreference: MotionPreferenceSource = {
  get: () => getClientSettings().motion,
  subscribe: subscribeClientSettings,
};
