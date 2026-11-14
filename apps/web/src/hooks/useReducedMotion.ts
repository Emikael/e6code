import { useLayoutEffect, useSyncExternalStore } from "react";

import { applyInterfaceMotion, prefersReducedMotion, subscribeReducedMotion } from "../lib/motion";
import { useClientSettings } from "./useSettings";

/** Reduced motion as render state: the system preference or the Motion setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

/** Mounted once at the app root; keeps `lib/motion` and the root attribute on the Motion setting. */
export function InterfaceMotionSync(): null {
  const interfaceMotion = useClientSettings((settings) => settings.interfaceMotion);
  useLayoutEffect(() => applyInterfaceMotion(interfaceMotion), [interfaceMotion]);
  return null;
}
