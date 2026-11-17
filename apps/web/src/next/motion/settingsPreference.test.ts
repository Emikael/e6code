import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const persistence = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence }),
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  ensureClientSettingsHydrated,
  persistClientSettingsPatch,
} from "~/hooks/useSettings";

import { createMotionPolicyStore } from "./policy.ts";
import { clientSettingsMotionPreference } from "./settingsPreference.ts";

const persistNowhere = async () => undefined;

/** OS reduced motion on, so "follows the system" is observable as Reduced. */
const reducedMotionOs = () => ({
  matches: true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

beforeEach(() => {
  persistence.getClientSettings.mockReset().mockResolvedValue(null);
  persistence.setClientSettings.mockReset().mockResolvedValue(undefined);
  __resetClientSettingsPersistenceForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clientSettingsMotionPreference", () => {
  it("follows the system before client settings load, with the setting unresolved", () => {
    const store = createMotionPolicyStore({ preference: clientSettingsMotionPreference });

    expect(store.getState()).toMatchObject({
      preference: "system",
      level: "full",
      settingResolved: false,
    });
  });

  it("resolves with the saved setting once client settings load", async () => {
    persistence.getClientSettings.mockResolvedValue({ ...DEFAULT_CLIENT_SETTINGS, motion: "off" });
    const store = createMotionPolicyStore({ preference: clientSettingsMotionPreference });
    const unsubscribe = store.subscribeState(() => undefined);

    await ensureClientSettingsHydrated();

    expect(store.getState()).toMatchObject({ level: "off", settingResolved: true });
    unsubscribe();
  });

  it("follows the system, with device constraints, after a failed load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    persistence.getClientSettings.mockRejectedValue(new Error("storage unavailable"));
    const store = createMotionPolicyStore({
      matchMedia: reducedMotionOs,
      preference: clientSettingsMotionPreference,
    });
    const unsubscribe = store.subscribeState(() => undefined);

    await expect(ensureClientSettingsHydrated()).rejects.toThrow("storage unavailable");

    expect(store.getState()).toMatchObject({
      preference: "system",
      level: "reduced",
      reasons: ["reduced-motion"],
      settingResolved: true,
    });
    unsubscribe();
  });

  it("applies a saved change through client settings without a reload", async () => {
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, motion: "full" });
    const store = createMotionPolicyStore({ preference: clientSettingsMotionPreference });
    const seen: Array<string> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getLevel()));

    await persistClientSettingsPatch({ motion: "off" }, persistNowhere);
    await persistClientSettingsPatch({ motion: "reduced" }, persistNowhere);
    unsubscribe();

    expect(seen).toEqual(["off", "reduced"]);
  });
});
