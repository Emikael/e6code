import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  persistClientSettingsPatch,
} from "~/hooks/useSettings";

import { createMotionPolicyStore } from "./policy.ts";
import { clientSettingsMotionPreference } from "./settingsPreference.ts";

const persistNowhere = async () => undefined;

afterEach(() => {
  __resetClientSettingsPersistenceForTests();
});

describe("clientSettingsMotionPreference", () => {
  it("follows the system before client settings load", () => {
    __resetClientSettingsPersistenceForTests();
    const store = createMotionPolicyStore({ preference: clientSettingsMotionPreference });

    expect(store.getState().preference).toBe("system");
    expect(store.getLevel()).toBe("full");
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
