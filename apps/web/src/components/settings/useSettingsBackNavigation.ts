import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

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
