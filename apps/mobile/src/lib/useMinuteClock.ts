import { minuteClock } from "@e6tools/client-runtime/minute-clock";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useSyncExternalStore } from "react";
import { AppState, type NativeEventSubscription } from "react-native";

const NOOP_UNSUBSCRIBE = () => {};

// One AppState listener for every clock reader, however many rows show minutes.
const appStateListeners = new Set<() => void>();
let appStateSubscription: NativeEventSubscription | null = null;
function subscribeAppState(listener: () => void): () => void {
  appStateListeners.add(listener);
  appStateSubscription ??= AppState.addEventListener("change", () => {
    for (const notify of appStateListeners) notify();
  });
  return () => {
    appStateListeners.delete(listener);
    if (appStateListeners.size === 0) {
      appStateSubscription?.remove();
      appStateSubscription = null;
    }
  };
}
const readAppIsActive = () => AppState.currentState === "active";

/**
 * Start-of-minute epoch milliseconds from the shared minute clock. It only
 * ticks while `enabled`, the screen is focused and the app is active; paused,
 * it reads the current minute on the next render instead of a stale one.
 */
export function useMinuteClock(enabled: boolean): number {
  const screenIsFocused = useIsFocused();
  const appIsActive = useSyncExternalStore(subscribeAppState, readAppIsActive);
  const ticking = enabled && screenIsFocused && appIsActive;
  const subscribe = useCallback(
    (listener: () => void) => (ticking ? minuteClock.subscribe(listener) : NOOP_UNSUBSCRIBE),
    [ticking],
  );
  return useSyncExternalStore(subscribe, minuteClock.getSnapshot);
}
