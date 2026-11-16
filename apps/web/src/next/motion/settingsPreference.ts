import type { MotionPreference } from "@e6tools/client-runtime/motion-level";

import {
  getClientSettings,
  isClientSettingsHydrated,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
} from "~/hooks/useSettings";

import type { MotionPreferenceSource } from "./policy.ts";

interface ClientSettingsAccess {
  readonly isHydrated: () => boolean;
  readonly getMotion: () => MotionPreference;
  readonly subscribeSettings: (listener: () => void) => () => void;
  readonly subscribeHydration: (listener: () => void) => () => void;
}

/**
 * The Motion setting as MotionPolicy reads it: unknown (`null`) until client settings hydrate.
 * A failed read stays unknown too, because its defaults would give Full to a user who chose
 * Off. Both listener sets are needed: saved settings land before the status turns ready, and a
 * new install with nothing saved turns ready without any settings change.
 */
export const createClientSettingsMotionPreference = (
  access: ClientSettingsAccess,
): MotionPreferenceSource => ({
  get: () => (access.isHydrated() ? access.getMotion() : null),
  subscribe: (listener) => {
    const stopSettings = access.subscribeSettings(listener);
    const stopHydration = access.subscribeHydration(listener);
    return () => {
      stopSettings();
      stopHydration();
    };
  },
});

export const clientSettingsMotionPreference = createClientSettingsMotionPreference({
  isHydrated: isClientSettingsHydrated,
  getMotion: () => getClientSettings().motion,
  subscribeSettings: subscribeClientSettings,
  subscribeHydration: subscribeClientSettingsHydration,
});
