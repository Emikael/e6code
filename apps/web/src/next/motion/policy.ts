import type { DesktopBridge, DesktopMotionPowerState } from "@e6tools/contracts";
import {
  type MotionLevel,
  type MotionPreference,
  resolveMotionLevel,
} from "@e6tools/client-runtime/motion-level";
import { useSyncExternalStore } from "react";

interface ChangeSource<Event extends string> {
  addEventListener(type: Event, listener: () => void): void;
  removeEventListener(type: Event, listener: () => void): void;
}

interface ReducedMotionQuery extends ChangeSource<"change"> {
  readonly matches: boolean;
}

/** Chromium's Battery Status API, secure contexts only. */
interface WebBattery extends ChangeSource<"chargingchange"> {
  readonly charging: boolean;
}

/** The device inputs MotionPolicy reads; each one is optional and absent means unconstrained. */
export interface MotionEnvironment {
  readonly matchMedia?: (query: string) => ReducedMotionQuery;
  readonly getBattery?: () => Promise<WebBattery>;
  /** `navigator.deviceMemory`, in GB. */
  readonly deviceMemory?: number;
  readonly bridge?: Pick<DesktopBridge, "getMotionPowerState" | "onMotionPowerStateChange">;
}

export interface MotionPolicyStore {
  readonly getLevel: () => MotionLevel;
  readonly subscribe: (listener: () => void) => () => void;
  /** The Motion setting; E02-T06 feeds it from client settings. */
  readonly setPreference: (preference: MotionPreference) => void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * One shared store per page. Device listeners are installed with the first subscriber and
 * removed with the last, so a page with no v2 motion pays nothing.
 */
export const createMotionPolicyStore = (environment: MotionEnvironment): MotionPolicyStore => {
  const { bridge, deviceMemory } = environment;
  const hasDesktopPower = bridge?.getMotionPowerState !== undefined;
  const media = environment.matchMedia?.(REDUCED_MOTION_QUERY);
  const listeners = new Set<() => void>();

  let preference: MotionPreference = "system";
  let desktopPower: DesktopMotionPowerState | null = null;
  let webOnBattery: boolean | null = null;
  let level: MotionLevel = "full";
  let teardown: Array<() => void> = [];
  let generation = 0;

  let desktopPowerRead = false;

  /** A synchronous IPC round trip: once at first use, then once each time listening starts. */
  const readDesktopPower = () => {
    desktopPowerRead = true;
    if (hasDesktopPower) desktopPower = bridge.getMotionPowerState?.() ?? null;
  };

  const compute = () =>
    resolveMotionLevel(preference, {
      prefersReducedMotion: media?.matches ?? false,
      onBattery: desktopPower?.onBattery ?? webOnBattery,
      thermalState: desktopPower?.thermalState ?? "unknown",
      deviceMemoryGb: deviceMemory ?? null,
    });

  const refresh = () => {
    const next = compute();
    if (next === level) return;
    level = next;
    for (const listener of listeners) listener();
  };

  const install = () => {
    const current = ++generation;
    readDesktopPower();
    level = compute();

    if (media !== undefined) {
      media.addEventListener("change", refresh);
      teardown.push(() => media.removeEventListener("change", refresh));
    }

    if (hasDesktopPower) {
      const stop = bridge.onMotionPowerStateChange?.((state) => {
        desktopPower = state;
        refresh();
      });
      if (stop !== undefined) teardown.push(stop);
    } else if (environment.getBattery !== undefined) {
      // Chained directly on the API's promise so callers awaiting it see the result applied.
      environment.getBattery().then(
        (battery) => {
          if (current !== generation) return;
          const onChargingChange = () => {
            webOnBattery = !battery.charging;
            refresh();
          };
          onChargingChange();
          battery.addEventListener("chargingchange", onChargingChange);
          teardown.push(() => battery.removeEventListener("chargingchange", onChargingChange));
        },
        () => undefined,
      );
    }
  };

  const uninstall = () => {
    generation++;
    for (const stop of teardown) stop();
    teardown = [];
  };

  return {
    getLevel: () => {
      // Unsubscribed callers (React's first render, code outside React) recompute from the
      // media query and the cached power state; only listening keeps the cache fresh.
      if (listeners.size === 0) {
        if (!desktopPowerRead) readDesktopPower();
        level = compute();
      }
      return level;
    },
    subscribe: (listener) => {
      if (listeners.size === 0) install();
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        uninstall();
      };
    },
    setPreference: (next) => {
      preference = next;
      refresh();
    },
  };
};

const browserEnvironment = (): MotionEnvironment => {
  if (typeof window === "undefined") return {};
  const navigatorWithDevice = navigator as Navigator & {
    readonly deviceMemory?: number;
    readonly getBattery?: () => Promise<WebBattery>;
  };
  return {
    matchMedia: (query) => window.matchMedia(query),
    ...(navigatorWithDevice.getBattery
      ? { getBattery: () => navigatorWithDevice.getBattery!() }
      : {}),
    ...(navigatorWithDevice.deviceMemory === undefined
      ? {}
      : { deviceMemory: navigatorWithDevice.deviceMemory }),
    ...(window.desktopBridge === undefined ? {} : { bridge: window.desktopBridge }),
  };
};

/** The page's MotionPolicy, for code outside React such as timeline runners. */
export const motionPolicy = createMotionPolicyStore(browserEnvironment());

/** The current motion level. Re-renders only when the level itself changes. */
export const useMotionPolicy = (): MotionLevel =>
  useSyncExternalStore(motionPolicy.subscribe, motionPolicy.getLevel);
