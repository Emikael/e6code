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
 * Where the Motion setting comes from. Before the saved value is known, and when it cannot be
 * read, the source reports Follow system (ENG-126): nothing reaches Off automatically.
 */
export interface MotionPreferenceSource {
  readonly get: () => MotionPreference;
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

/**
 * Everything the Motion control shows, from one computation, so its words, icon and the level
 * in use always agree.
 */
export interface MotionPolicyState {
  readonly preference: MotionPreference;
  readonly level: MotionLevel;
  /** The device constraints that hold now, even when an explicit level ignores them. */
  readonly reasons: ReadonlyArray<MotionConstraintReason>;
}

export interface MotionPolicyStore {
  readonly getLevel: () => MotionLevel;
  readonly subscribe: (listener: () => void) => () => void;
  /** Keeps its identity until the preference, level or reasons change. */
  readonly getState: () => MotionPolicyState;
  /** Notified on any state change; level subscribers are notified only on level changes. */
  readonly subscribeState: (listener: () => void) => () => void;
  /** Sets the Motion setting directly; the page store takes it from `preference` instead. */
  readonly setPreference: (preference: MotionPreference) => void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const sameState = (a: MotionPolicyState, b: MotionPolicyState) =>
  a.preference === b.preference &&
  a.level === b.level &&
  a.reasons.length === b.reasons.length &&
  a.reasons.every((reason, index) => reason === b.reasons[index]);

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
  const stateListeners = new Set<() => void>();
  const listening = () => levelListeners.size + stateListeners.size > 0;

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

  let preference: MotionPreference = "system";
  let desktopPower: DesktopMotionPowerState | null = null;
  let webOnBattery: boolean | null = null;
  let state: MotionPolicyState = { preference, level: "full", reasons: [] };
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

  /** The next state, or the current object when nothing changed. */
  const compute = (): MotionPolicyState => {
    const current = constraints();
    const next = {
      preference,
      level: resolveMotionLevel(preference, current),
      reasons: activeMotionConstraints(current),
    };
    return sameState(next, state) ? state : next;
  };

  const refresh = () => {
    const next = compute();
    if (next === state) return;
    const levelChanged = next.level !== state.level;
    state = next;
    if (levelChanged) for (const listener of levelListeners) listener();
    for (const listener of stateListeners) listener();
  };

  const install = () => {
    const current = ++generation;
    readDesktopPower();
    readPreference();
    state = compute();

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
      const stop = bridge.onMotionPowerStateChange?.((power) => {
        desktopPower = power;
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
    state = compute();
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
      return state.level;
    },
    subscribe: subscribeTo(levelListeners),
    getState: () => {
      readUnsubscribed();
      return state;
    },
    subscribeState: subscribeTo(stateListeners),
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
 * Motion setting from client settings, and follows the system until they load.
 */
export const motionPolicy = createMotionPolicyStore({
  ...browserEnvironment(),
  preference: clientSettingsMotionPreference,
});

/** The current motion level. Re-renders only when the level itself changes. */
export const useMotionPolicy = (): MotionLevel =>
  useSyncExternalStore(motionPolicy.subscribe, motionPolicy.getLevel);

const subscribeNothing = () => () => undefined;
const IDLE_STATE: MotionPolicyState = { preference: "system", level: "full", reasons: [] };
const getIdleState = () => IDLE_STATE;

/**
 * The Motion setting, the level in use and the reasons, from one snapshot. While `enabled` is
 * false it neither subscribes nor reads, so an always-mounted caller (the command palette)
 * starts no device listeners for classic users.
 */
export const useMotionPolicyState = (enabled = true): MotionPolicyState =>
  useSyncExternalStore(
    enabled ? motionPolicy.subscribeState : subscribeNothing,
    enabled ? motionPolicy.getState : getIdleState,
  );
