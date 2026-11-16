import type { DesktopBridge, DesktopMotionPowerState } from "@e6tools/contracts";
import {
  activeMotionConstraints,
  type MotionConstraintReason,
  type MotionConstraints,
  type MotionLevel,
  type MotionPreference,
  resolveMotionLevel,
} from "@e6tools/client-runtime/motion-level";
import { useSyncExternalStore } from "react";

import { clientSettingsMotionPreference } from "./settingsPreference.ts";

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

/**
 * Where the Motion setting comes from. `get` returns `null` until the saved value is known;
 * the policy is Off until then, so a user who chose Off never sees Full frames at boot.
 */
export interface MotionPreferenceSource {
  readonly get: () => MotionPreference | null;
  readonly subscribe: (listener: () => void) => () => void;
}

/** The device inputs MotionPolicy reads; each one is optional and absent means unconstrained. */
export interface MotionEnvironment {
  readonly matchMedia?: (query: string) => ReducedMotionQuery;
  readonly getBattery?: () => Promise<WebBattery>;
  /** `navigator.deviceMemory`, in GB. */
  readonly deviceMemory?: number;
  readonly bridge?: Pick<DesktopBridge, "getMotionPowerState" | "onMotionPowerStateChange">;
  /** The Motion setting. Absent means Follow system unless `setPreference` says otherwise. */
  readonly preference?: MotionPreferenceSource;
}

export interface MotionPolicyStore {
  readonly getLevel: () => MotionLevel;
  readonly subscribe: (listener: () => void) => () => void;
  /** The device constraints that hold now, for the Motion setting's explanation line. */
  readonly getReasons: () => ReadonlyArray<MotionConstraintReason>;
  /** Notified only when the reasons change, so level subscribers are not disturbed. */
  readonly subscribeReasons: (listener: () => void) => () => void;
  /** Sets the Motion setting directly; the page store takes it from `preference` instead. */
  readonly setPreference: (preference: MotionPreference) => void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const sameReasons = (
  a: ReadonlyArray<MotionConstraintReason>,
  b: ReadonlyArray<MotionConstraintReason>,
) => a.length === b.length && a.every((reason, index) => reason === b[index]);

/**
 * One shared store per page. Device and setting listeners are installed with the first
 * subscriber and removed with the last, so a page with no v2 motion pays nothing.
 */
export const createMotionPolicyStore = (environment: MotionEnvironment): MotionPolicyStore => {
  const { bridge, deviceMemory, preference: preferenceSource } = environment;
  const hasDesktopPower = bridge?.getMotionPowerState !== undefined;
  // A shell with the getter but no change events gives a one-shot value; battery changes
  // then come from the web API when the browser has it.
  const hasDesktopEvents = hasDesktopPower && bridge?.onMotionPowerStateChange !== undefined;
  const levelListeners = new Set<() => void>();
  const reasonListeners = new Set<() => void>();
  const listening = () => levelListeners.size + reasonListeners.size > 0;

  // Queried on first need, so importing this module never touches the DOM.
  let media: ReducedMotionQuery | undefined;
  let mediaQueried = false;
  const reducedMotionQuery = () => {
    if (!mediaQueried) {
      mediaQueried = true;
      media = environment.matchMedia?.(REDUCED_MOTION_QUERY);
    }
    return media;
  };

  // `null` while the saved setting is not known yet.
  let preference: MotionPreference | null = preferenceSource === undefined ? "system" : null;
  let desktopPower: DesktopMotionPowerState | null = null;
  let webOnBattery: boolean | null = null;
  let level: MotionLevel = "full";
  let reasons: ReadonlyArray<MotionConstraintReason> = [];
  let teardown: Array<() => void> = [];
  let generation = 0;

  let desktopPowerRead = false;

  /** A synchronous IPC round trip: once at first use, then once each time listening starts. */
  const readDesktopPower = () => {
    desktopPowerRead = true;
    if (hasDesktopPower) desktopPower = bridge.getMotionPowerState?.() ?? null;
  };

  const readPreference = () => {
    if (preferenceSource !== undefined) preference = preferenceSource.get();
  };

  const constraints = (): MotionConstraints => ({
    prefersReducedMotion: reducedMotionQuery()?.matches ?? false,
    // Only set when the desktop cannot push changes; then the live web value wins.
    onBattery: webOnBattery ?? desktopPower?.onBattery ?? null,
    thermalState: desktopPower?.thermalState ?? "unknown",
    deviceMemoryGb: deviceMemory ?? null,
  });

  /** Recomputes both snapshots; the reasons array keeps its identity while unchanged. */
  const compute = () => {
    const current = constraints();
    const nextReasons = activeMotionConstraints(current);
    return {
      level: preference === null ? ("off" as const) : resolveMotionLevel(preference, current),
      reasons: sameReasons(nextReasons, reasons) ? reasons : nextReasons,
    };
  };

  const refresh = () => {
    const next = compute();
    const levelChanged = next.level !== level;
    const reasonsChanged = next.reasons !== reasons;
    level = next.level;
    reasons = next.reasons;
    if (levelChanged) for (const listener of levelListeners) listener();
    if (reasonsChanged) for (const listener of reasonListeners) listener();
  };

  const install = () => {
    const current = ++generation;
    readDesktopPower();
    readPreference();
    ({ level, reasons } = compute());

    if (preferenceSource !== undefined) {
      teardown.push(
        preferenceSource.subscribe(() => {
          readPreference();
          refresh();
        }),
      );
    }

    const query = reducedMotionQuery();
    if (query !== undefined) {
      query.addEventListener("change", refresh);
      teardown.push(() => query.removeEventListener("change", refresh));
    }

    if (hasDesktopEvents) {
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

  /** Stops listening and drops what only listening kept fresh. */
  const uninstall = () => {
    generation++;
    for (const stop of teardown) stop();
    teardown = [];
    webOnBattery = null;
    desktopPowerRead = false;
  };

  // Unsubscribed callers (React's first render, code outside React) recompute from the
  // media query, the setting and the cached power state; only listening keeps the cache fresh.
  const readUnsubscribed = () => {
    if (listening()) return;
    if (!desktopPowerRead) readDesktopPower();
    readPreference();
    ({ level, reasons } = compute());
  };

  const subscribeTo = (set: Set<() => void>) => (listener: () => void) => {
    if (!listening()) install();
    set.add(listener);
    return () => {
      if (!set.delete(listener) || listening()) return;
      uninstall();
    };
  };

  return {
    getLevel: () => {
      readUnsubscribed();
      return level;
    },
    subscribe: subscribeTo(levelListeners),
    getReasons: () => {
      readUnsubscribed();
      return reasons;
    },
    subscribeReasons: subscribeTo(reasonListeners),
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
    ...(typeof window.matchMedia === "function"
      ? { matchMedia: (query: string) => window.matchMedia(query) }
      : {}),
    ...(navigatorWithDevice.getBattery
      ? { getBattery: () => navigatorWithDevice.getBattery!() }
      : {}),
    ...(navigatorWithDevice.deviceMemory === undefined
      ? {}
      : { deviceMemory: navigatorWithDevice.deviceMemory }),
    ...(window.desktopBridge === undefined ? {} : { bridge: window.desktopBridge }),
  };
};

/**
 * The page's MotionPolicy, for code outside React such as timeline runners. It reads the
 * Motion setting from client settings and is Off until they hydrate, so a v2 surface that
 * plays at boot awaits `ensureClientSettingsHydrated()` first or starts without motion.
 */
export const motionPolicy = createMotionPolicyStore({
  ...browserEnvironment(),
  preference: clientSettingsMotionPreference,
});

/** The current motion level. Re-renders only when the level itself changes. */
export const useMotionPolicy = (): MotionLevel =>
  useSyncExternalStore(motionPolicy.subscribe, motionPolicy.getLevel);

/** The device constraints that hold now. Re-renders only when they change. */
export const useMotionConstraintReasons = (): ReadonlyArray<MotionConstraintReason> =>
  useSyncExternalStore(motionPolicy.subscribeReasons, motionPolicy.getReasons);
