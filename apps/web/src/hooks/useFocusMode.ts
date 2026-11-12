import { parseScopedThreadKey } from "@e6tools/client-runtime/environment";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { focusOpenedPanelsToClose } from "../focusMode";
import { useRightPanelStore } from "../rightPanelStore";
import { useUiStateStore } from "../uiStateStore";

/**
 * Whether focus mode shapes this screen. Focus is about one thread, so it
 * applies on a thread's route; elsewhere (a new thread, the start screen,
 * Settings) the stored flag waits and the layout is the usual one.
 */
export function useFocusModeActive(): boolean {
  const focusMode = useUiStateStore((state) => state.focusMode);
  const onThread = useParams({
    strict: false,
    select: (params) => Boolean(params.environmentId && params.threadId),
  });
  return focusMode && onThread;
}

/**
 * Shows the right panel during focus once something opens it there (Mod+D,
 * Review diff, Changes so far, a file link), and hides it again when it is
 * closed. Switching thread in focus starts hidden again.
 */
export function useFocusPanelPeek(
  focusModeActive: boolean,
  threadKey: string | null,
  panel: { readonly isOpen: boolean; readonly activeSurfaceId: string | null },
): void {
  const previous = useRef<{
    threadKey: string | null;
    isOpen: boolean;
    activeSurfaceId: string | null;
  } | null>(null);
  const { isOpen, activeSurfaceId } = panel;
  useEffect(() => {
    const prior = previous.current;
    previous.current = focusModeActive ? { threadKey, isOpen, activeSurfaceId } : null;
    if (!focusModeActive || !prior) return;
    const { setFocusPanelPeek } = useUiStateStore.getState();
    if (prior.threadKey !== threadKey || !isOpen) {
      setFocusPanelPeek(false);
      return;
    }
    if (!prior.isOpen && threadKey) {
      // Focus opened a closed panel; it closes again when the peek ends.
      useUiStateStore.getState().noteFocusOpenedPanel(threadKey);
    } else if (prior.activeSurfaceId !== activeSurfaceId) {
      setFocusPanelPeek(true);
    }
  }, [activeSurfaceId, focusModeActive, isOpen, threadKey]);
}

/**
 * Closes the right panels focus opened once nothing peeks any more: the peek
 * was hidden, the thread switched, focus exited (from any route) or a reload
 * dropped the peek. Mount once, at the root.
 */
export function useCloseFocusOpenedPanels(): void {
  useEffect(() => {
    const settle = (state: Parameters<typeof focusOpenedPanelsToClose>[0]) => {
      const keys = focusOpenedPanelsToClose(state);
      if (keys.length === 0) return;
      const { close } = useRightPanelStore.getState();
      for (const key of keys) {
        const ref = parseScopedThreadKey(key);
        if (ref) close(ref);
      }
      useUiStateStore.getState().clearFocusOpenedPanels(keys);
    };
    settle(useUiStateStore.getState());
    return useUiStateStore.subscribe((state, previous) => {
      if (
        state.focusMode !== previous.focusMode ||
        state.focusPanelPeek !== previous.focusPanelPeek ||
        state.focusOpenedPanelKeys !== previous.focusOpenedPanelKeys
      ) {
        settle(state);
      }
    });
  }, []);
}
