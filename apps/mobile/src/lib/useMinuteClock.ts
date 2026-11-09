import { minuteClock } from "@e6tools/client-runtime/minute-clock";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

const NOOP_UNSUBSCRIBE = () => {};

/**
 * Start-of-minute epoch milliseconds from the shared minute clock. It only
 * ticks while `enabled`, the screen is focused and the app is active; paused,
 * it reads the current minute on the next render instead of a stale one.
 */
export function useMinuteClock(enabled: boolean): number {
  const screenIsFocused = useIsFocused();
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppIsActive(state === "active");
    });
    return () => subscription.remove();
  }, []);
  const ticking = enabled && screenIsFocused && appIsActive;
  const subscribe = useCallback(
    (listener: () => void) => (ticking ? minuteClock.subscribe(listener) : NOOP_UNSUBSCRIBE),
    [ticking],
  );
  return useSyncExternalStore(subscribe, minuteClock.getSnapshot);
}
