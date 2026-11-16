import type { DesktopMotionPowerState } from "@e6tools/contracts";
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

  it("reads the desktop power state over IPC once, and again only when listening starts", () => {
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
    store.getLevel();
    expect(reads).toBe(2);
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
