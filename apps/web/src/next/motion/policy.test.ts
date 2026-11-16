import type { DesktopMotionPowerState } from "@e6tools/contracts";
import type { MotionPreference } from "@e6tools/client-runtime/motion-level";
import { describe, expect, it } from "vite-plus/test";

import { createMotionPolicyStore } from "./policy.ts";

const fakeMediaQuery = (initial: boolean) => {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: "change", listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => void listeners.delete(listener),
  };
  return {
    matchMedia: () => query,
    set(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
};

const fakeBattery = (charging: boolean) => {
  const listeners = new Set<() => void>();
  const battery = {
    charging,
    addEventListener: (_type: "chargingchange", listener: () => void) =>
      void listeners.add(listener),
    removeEventListener: (_type: "chargingchange", listener: () => void) =>
      void listeners.delete(listener),
  };
  const ready = Promise.resolve(battery);
  return {
    getBattery: () => ready,
    ready,
    set(next: boolean) {
      battery.charging = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
};

const fakeBridge = (initial: DesktopMotionPowerState) => {
  const listeners = new Set<(state: DesktopMotionPowerState) => void>();
  return {
    bridge: {
      getMotionPowerState: () => initial,
      onMotionPowerStateChange: (listener: (state: DesktopMotionPowerState) => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    push(state: DesktopMotionPowerState) {
      for (const listener of listeners) listener(state);
    },
    listenerCount: () => listeners.size,
  };
};

const subscribeLevels = (store: ReturnType<typeof createMotionPolicyStore>) => {
  const seen: Array<string> = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getLevel()));
  return { seen, unsubscribe };
};

describe("createMotionPolicyStore", () => {
  it("is Full in a plain browser with no constraint", () => {
    const store = createMotionPolicyStore({});
    expect(store.getLevel()).toBe("full");
  });

  it("follows OS reduced motion without a reload", () => {
    const media = fakeMediaQuery(false);
    const store = createMotionPolicyStore({ matchMedia: media.matchMedia });
    const { seen } = subscribeLevels(store);

    media.set(true);
    media.set(false);

    expect(seen).toEqual(["reduced", "full"]);
  });

  it("drops to Reduced when the web battery stops charging", async () => {
    const battery = fakeBattery(true);
    const store = createMotionPolicyStore({ getBattery: battery.getBattery });
    const { seen } = subscribeLevels(store);
    await battery.ready;

    battery.set(false);
    battery.set(true);

    expect(seen).toEqual(["reduced", "full"]);
  });

  it("starts Reduced when the web battery is already discharging", async () => {
    const battery = fakeBattery(false);
    const store = createMotionPolicyStore({ getBattery: battery.getBattery });
    subscribeLevels(store);
    await battery.ready;

    expect(store.getLevel()).toBe("reduced");
  });

  it("knows the desktop power state at the first frame and follows its changes", () => {
    const desktop = fakeBridge({ onBattery: true, thermalState: "nominal" });
    const store = createMotionPolicyStore({ bridge: desktop.bridge });
    expect(store.getLevel()).toBe("reduced");

    const { seen } = subscribeLevels(store);
    desktop.push({ onBattery: false, thermalState: "nominal" });
    desktop.push({ onBattery: false, thermalState: "serious" });
    desktop.push({ onBattery: false, thermalState: "fair" });

    expect(seen).toEqual(["full", "reduced", "full"]);
  });

  it("prefers the desktop bridge over the web battery", async () => {
    const battery = fakeBattery(false);
    const desktop = fakeBridge({ onBattery: false, thermalState: "nominal" });
    const store = createMotionPolicyStore({
      getBattery: battery.getBattery,
      bridge: desktop.bridge,
    });
    subscribeLevels(store);
    await battery.ready;

    expect(store.getLevel()).toBe("full");
    expect(battery.listenerCount()).toBe(0);
  });

  it("falls back to web inputs on a desktop shell without the power member", () => {
    const media = fakeMediaQuery(true);
    const store = createMotionPolicyStore({ matchMedia: media.matchMedia, bridge: {} });
    expect(store.getLevel()).toBe("reduced");
  });

  it("drops to Reduced on a device with 4 GB of memory or less", () => {
    expect(createMotionPolicyStore({ deviceMemory: 4 }).getLevel()).toBe("reduced");
    expect(createMotionPolicyStore({ deviceMemory: 8 }).getLevel()).toBe("full");
  });

  it("lets an explicit preference win over every constraint", () => {
    const media = fakeMediaQuery(true);
    const store = createMotionPolicyStore({ matchMedia: media.matchMedia, deviceMemory: 2 });
    const { seen } = subscribeLevels(store);

    store.setPreference("full");
    media.set(false);
    store.setPreference("off");
    store.setPreference("system"); // Low memory still holds.

    expect(seen).toEqual(["full", "off", "reduced"]);
  });

  it("notifies only when the level changes", () => {
    const media = fakeMediaQuery(false);
    const desktop = fakeBridge({ onBattery: true, thermalState: "nominal" });
    const store = createMotionPolicyStore({ matchMedia: media.matchMedia, bridge: desktop.bridge });
    const { seen } = subscribeLevels(store);

    media.set(true); // Already Reduced because of the battery.
    desktop.push({ onBattery: true, thermalState: "critical" });

    expect(seen).toEqual([]);
  });

  it("removes every device listener when the last subscriber leaves", async () => {
    const media = fakeMediaQuery(false);
    const battery = fakeBattery(true);
    const store = createMotionPolicyStore({
      matchMedia: media.matchMedia,
      getBattery: battery.getBattery,
    });
    const first = subscribeLevels(store);
    const second = subscribeLevels(store);
    await battery.ready;
    expect([media.listenerCount(), battery.listenerCount()]).toEqual([1, 1]);

    first.unsubscribe();
    expect([media.listenerCount(), battery.listenerCount()]).toEqual([1, 1]);
    second.unsubscribe();
    expect([media.listenerCount(), battery.listenerCount()]).toEqual([0, 0]);
  });

  it("does not attach a battery listener that resolves after the last subscriber left", async () => {
    const battery = fakeBattery(true);
    const store = createMotionPolicyStore({ getBattery: battery.getBattery });
    subscribeLevels(store).unsubscribe();
    await battery.ready;

    expect(battery.listenerCount()).toBe(0);
  });

  it("reads the desktop power state over IPC once per listening period", () => {
    const desktop = fakeBridge({ onBattery: false, thermalState: "nominal" });
    let reads = 0;
    const store = createMotionPolicyStore({
      bridge: {
        ...desktop.bridge,
        getMotionPowerState: () => {
          reads++;
          return desktop.bridge.getMotionPowerState();
        },
      },
    });

    for (let render = 0; render < 50; render++) store.getLevel();
    expect(reads).toBe(1);

    const { unsubscribe } = subscribeLevels(store);
    for (let render = 0; render < 50; render++) store.getLevel();
    unsubscribe();
    for (let render = 0; render < 50; render++) store.getLevel();
    // Listening stopped, so the cache may be stale: the next read refreshes it once.
    expect(reads).toBe(3);
  });

  it("forgets the web battery state when listening stops", async () => {
    const battery = fakeBattery(false);
    const store = createMotionPolicyStore({ getBattery: battery.getBattery });
    const { unsubscribe } = subscribeLevels(store);
    await battery.ready;
    expect(store.getLevel()).toBe("reduced");

    unsubscribe();
    battery.set(true);

    expect(store.getLevel()).toBe("full");
  });

  it("rereads the desktop power state after listening stops", () => {
    let current: DesktopMotionPowerState = { onBattery: false, thermalState: "nominal" };
    const listeners = new Set<(state: DesktopMotionPowerState) => void>();
    const store = createMotionPolicyStore({
      bridge: {
        getMotionPowerState: () => current,
        onMotionPowerStateChange: (listener) => {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      },
    });
    const { unsubscribe } = subscribeLevels(store);
    current = { onBattery: true, thermalState: "nominal" };
    for (const listener of listeners) listener(current);
    expect(store.getLevel()).toBe("reduced");

    unsubscribe();
    current = { onBattery: false, thermalState: "nominal" };

    expect(store.getLevel()).toBe("full");
  });

  it("uses a desktop shell's one-shot power state when it cannot push changes", () => {
    const store = createMotionPolicyStore({
      bridge: { getMotionPowerState: () => ({ onBattery: true, thermalState: "nominal" }) },
    });
    subscribeLevels(store);
    expect(store.getLevel()).toBe("reduced");
  });

  it("follows web battery changes on a desktop shell that cannot push them", async () => {
    const battery = fakeBattery(true);
    const store = createMotionPolicyStore({
      getBattery: battery.getBattery,
      bridge: { getMotionPowerState: () => ({ onBattery: false, thermalState: "fair" }) },
    });
    const { seen } = subscribeLevels(store);
    await battery.ready;

    battery.set(false);
    battery.set(true);

    expect(seen).toEqual(["reduced", "full"]);
  });

  it("keeps the one-shot thermal state while web battery reports changes", async () => {
    const battery = fakeBattery(true);
    const store = createMotionPolicyStore({
      getBattery: battery.getBattery,
      bridge: { getMotionPowerState: () => ({ onBattery: false, thermalState: "serious" }) },
    });
    subscribeLevels(store);
    await battery.ready;

    expect(store.getLevel()).toBe("reduced");
  });

  it("does not query the media list until the level is first needed", () => {
    let queries = 0;
    const media = fakeMediaQuery(false);
    const store = createMotionPolicyStore({
      matchMedia: () => {
        queries++;
        return media.matchMedia();
      },
    });
    expect(queries).toBe(0);

    store.getLevel();
    subscribeLevels(store);

    expect(queries).toBe(1);
  });

  it("removes the desktop listener with the last subscriber", () => {
    const desktop = fakeBridge({ onBattery: false, thermalState: "nominal" });
    const store = createMotionPolicyStore({ bridge: desktop.bridge });
    const { unsubscribe } = subscribeLevels(store);
    expect(desktop.listenerCount()).toBe(1);
    unsubscribe();
    expect(desktop.listenerCount()).toBe(0);
  });
});

const fakePreference = (initial: MotionPreference) => {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    source: {
      get: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    set(next: MotionPreference) {
      current = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
};

describe("createMotionPolicyStore with the Motion setting", () => {
  it("follows the system until the saved setting loads, then applies it", () => {
    const media = fakeMediaQuery(true);
    const preference = fakePreference("system"); // The pre-hydration default.
    const store = createMotionPolicyStore({
      matchMedia: media.matchMedia,
      preference: preference.source,
    });
    const { seen } = subscribeLevels(store);
    expect(store.getLevel()).toBe("reduced");

    preference.set("off");

    expect(seen).toEqual(["off"]);
  });

  it("applies a changed setting without a reload", () => {
    const preference = fakePreference("system");
    const store = createMotionPolicyStore({ preference: preference.source });
    const { seen } = subscribeLevels(store);

    preference.set("reduced");
    preference.set("off");
    preference.set("full");

    expect(seen).toEqual(["reduced", "off", "full"]);
  });

  it("keeps an explicit level through OS and battery changes, and Follow system reacts", async () => {
    const media = fakeMediaQuery(false);
    const battery = fakeBattery(true);
    const preference = fakePreference("full");
    const store = createMotionPolicyStore({
      matchMedia: media.matchMedia,
      getBattery: battery.getBattery,
      preference: preference.source,
    });
    const { seen } = subscribeLevels(store);
    await battery.ready;

    media.set(true);
    battery.set(false);
    expect(seen).toEqual([]);

    preference.set("system");
    media.set(false);
    battery.set(true);

    expect(seen).toEqual(["reduced", "full"]);
  });

  it("reads the setting fresh for callers that do not subscribe", () => {
    const preference = fakePreference("system");
    const store = createMotionPolicyStore({ preference: preference.source });
    expect(store.getLevel()).toBe("full");

    preference.set("reduced");

    expect(store.getLevel()).toBe("reduced");
  });

  it("stops listening to the setting with the last subscriber", () => {
    const preference = fakePreference("system");
    const store = createMotionPolicyStore({ preference: preference.source });
    const levels = subscribeLevels(store);
    const stopState = store.subscribeState(() => undefined);
    expect(preference.listenerCount()).toBe(1);

    levels.unsubscribe();
    expect(preference.listenerCount()).toBe(1);
    stopState();
    expect(preference.listenerCount()).toBe(0);
  });
});

describe("createMotionPolicyStore state", () => {
  it("reports the setting, the level and the constraints an explicit level ignores", () => {
    const media = fakeMediaQuery(true);
    const store = createMotionPolicyStore({ matchMedia: media.matchMedia, deviceMemory: 2 });
    store.setPreference("full");

    expect(store.getState()).toEqual({
      preference: "full",
      level: "full",
      reasons: ["reduced-motion", "memory"],
    });
  });

  it("notifies state listeners without disturbing level listeners", () => {
    const desktop = fakeBridge({ onBattery: true, thermalState: "nominal" });
    const store = createMotionPolicyStore({ bridge: desktop.bridge });
    const levels = subscribeLevels(store);
    const seenReasons: Array<ReadonlyArray<string>> = [];
    store.subscribeState(() => seenReasons.push(store.getState().reasons));

    desktop.push({ onBattery: true, thermalState: "critical" }); // Still Reduced.
    desktop.push({ onBattery: true, thermalState: "fair" });

    expect(levels.seen).toEqual([]);
    expect(seenReasons).toEqual([["battery", "thermal"], ["battery"]]);
  });

  it("keeps the same state object while nothing changes", () => {
    const store = createMotionPolicyStore({ deviceMemory: 2 });
    expect(store.getState()).toBe(store.getState());
  });
});
