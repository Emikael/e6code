import type { AnyRouter } from "@tanstack/react-router";

// Leaf route id of each history entry this tab has resolved, keyed by the
// router's history index. Settings reads the entry before its own to name the
// page that history-back returns to. Entries from before a reload are unknown.
const routeIdByHistoryIndex = new Map<number, string>();

/** Records where each history entry landed. Start it before the router's first load. */
export function trackSettingsBackDestination(router: AnyRouter): () => void {
  return router.subscribe("onResolved", ({ toLocation }) => {
    const routeId = router.state.matches.at(-1)?.routeId;
    if (routeId) routeIdByHistoryIndex.set(toLocation.state.__TSR_index, routeId);
  });
}

export function previousSettingsBackRouteId(historyIndex: number): string | undefined {
  return routeIdByHistoryIndex.get(historyIndex - 1);
}

/**
 * Names the page that settings' back action lands on. Without history it
 * opens the thread list; otherwise it is the previous entry, or a plain
 * "Back" when that entry is unknown or is another settings view.
 */
export function settingsBackLabel(canGoBack: boolean, previousRouteId: string | undefined) {
  if (!canGoBack) return "Threads";
  if (previousRouteId === "/usage") return "Usage";
  if (previousRouteId === "/_chat/pull-requests") return "Pull requests";
  if (previousRouteId?.startsWith("/_chat/")) return "Threads";
  return "Back";
}
