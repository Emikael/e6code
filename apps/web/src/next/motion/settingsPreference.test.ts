import type { MotionPreference } from "@e6tools/client-runtime/motion-level";
import { describe, expect, it } from "vite-plus/test";

import { createMotionPolicyStore } from "./policy.ts";
import { createClientSettingsMotionPreference } from "./settingsPreference.ts";

/** Mirrors `useSettings`: separate listener sets for settings changes and hydration status. */
const fakeClientSettings = () => {
  let hydrated = false;
  let motion: MotionPreference = "system";
  const settingsListeners = new Set<() => void>();
  const hydrationListeners = new Set<() => void>();
  const subscribe = (set: Set<() => void>) => (listener: () => void) => {
    set.add(listener);
    return () => void set.delete(listener);
  };
  return {
    access: {
      isHydrated: () => hydrated,
      getMotion: () => motion,
      subscribeSettings: subscribe(settingsListeners),
      subscribeHydration: subscribe(hydrationListeners),
    },
    replaceSettings(next: MotionPreference) {
      motion = next;
      for (const listener of settingsListeners) listener();
    },
    setHydrated() {
      hydrated = true;
      for (const listener of hydrationListeners) listener();
    },
    listenerCount: () => settingsListeners.size + hydrationListeners.size,
  };
};

const policyFor = (settings: ReturnType<typeof fakeClientSettings>) => {
  const store = createMotionPolicyStore({
    preference: createClientSettingsMotionPreference(settings.access),
  });
  const seen: Array<string> = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getLevel()));
  return { store, seen, unsubscribe };
};

describe("clientSettingsMotionPreference", () => {
  it("applies saved settings that land before hydration reports ready", () => {
    const settings = fakeClientSettings();
    const { store, seen } = policyFor(settings);

    settings.replaceSettings("reduced"); // Saved value arrives while status is still pending.
    expect(store.getLevel()).toBe("off");
    settings.setHydrated();

    expect(store.getLevel()).toBe("reduced");
    expect(seen).toEqual(["reduced"]);
  });

  it("follows the system on a new install that reaches ready with nothing saved", () => {
    const settings = fakeClientSettings();
    const { store } = policyFor(settings);

    settings.setHydrated();

    expect(store.getLevel()).toBe("full");
  });

  it("stays Off while a failed read leaves the saved setting unknown", () => {
    const settings = fakeClientSettings();
    const { store } = policyFor(settings);

    // A failed hydration notifies with defaults but never reports ready.
    settings.replaceSettings("system");

    expect(store.getLevel()).toBe("off");
  });

  it("releases both listener sets when the policy stops listening", () => {
    const settings = fakeClientSettings();
    const { unsubscribe } = policyFor(settings);
    expect(settings.listenerCount()).toBe(2);

    unsubscribe();

    expect(settings.listenerCount()).toBe(0);
  });
});
