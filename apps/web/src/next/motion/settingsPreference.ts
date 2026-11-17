import {
  getClientSettings,
  getClientSettingsHydrationStatus,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
} from "~/hooks/useSettings";

import type { MotionPreferenceSource } from "./policy.ts";

/**
 * The Motion setting as MotionPolicy reads it. Before client settings hydrate, and when the
 * read fails, the snapshot holds the schema default, Follow system (ENG-126). The setting is
 * resolved once the first load has finished, successfully or not; saved settings land
 * before the status turns ready, so both listener sets feed the policy.
 */
export const clientSettingsMotionPreference: MotionPreferenceSource = {
  get: () => getClientSettings().motion,
  isResolved: () => getClientSettingsHydrationStatus() !== "pending",
  subscribe: (listener) => {
    const stopSettings = subscribeClientSettings(listener);
    const stopHydration = subscribeClientSettingsHydration(listener);
    return () => {
      stopSettings();
      stopHydration();
    };
  },
};
