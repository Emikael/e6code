import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { previousSettingsBackRouteId, settingsBackLabel } from "./settingsBackDestination";

/**
 * Leaves settings for wherever the user came from, or the thread list when
 * settings was opened directly. Shared by the nav's back link and Esc.
 */
export function useSettingsBackNavigation() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  return useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);
}

/** The name of the page `useSettingsBackNavigation` returns to, for its button label. */
export function useSettingsBackLabel() {
  const canGoBack = useCanGoBack();
  const historyIndex = useLocation({ select: (location) => location.state.__TSR_index });
  return settingsBackLabel(canGoBack, previousSettingsBackRouteId(historyIndex));
}
