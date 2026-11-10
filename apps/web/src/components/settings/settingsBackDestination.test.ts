import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import {
  previousSettingsBackRouteId,
  settingsBackLabel,
  trackSettingsBackDestination,
} from "./settingsBackDestination";

function createAppRouter(initialEntry: string) {
  const root = createRootRoute();
  const chat = createRoute({ getParentRoute: () => root, id: "_chat" });
  const threads = createRoute({ getParentRoute: () => chat, path: "/" });
  const pullRequests = createRoute({ getParentRoute: () => chat, path: "pull-requests" });
  const usage = createRoute({ getParentRoute: () => root, path: "usage" });
  const settings = createRoute({ getParentRoute: () => root, path: "settings" });
  const general = createRoute({ getParentRoute: () => settings, path: "general" });
  const providers = createRoute({ getParentRoute: () => settings, path: "providers" });
  const router = createRouter({
    routeTree: root.addChildren([
      chat.addChildren([threads, pullRequests]),
      usage,
      settings.addChildren([general, providers]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    isServer: false,
    origin: "http://localhost",
  });
  trackSettingsBackDestination(router);
  return router;
}

function currentBackLabel(router: ReturnType<typeof createAppRouter>) {
  const index = router.state.location.state.__TSR_index;
  return settingsBackLabel(index !== 0, previousSettingsBackRouteId(index));
}

describe("settings back destination", () => {
  it("names the page settings was opened from, across section switches", async () => {
    const router = createAppRouter("/usage");
    await router.load();
    await router.navigate({ to: "/settings/general" });
    // Section switches replace the entry, so back still leaves settings.
    await router.navigate({ to: "/settings/providers", replace: true });

    expect(currentBackLabel(router)).toBe("Usage");
  });

  it("names pull requests and threads", async () => {
    const router = createAppRouter("/pull-requests");
    await router.load();
    await router.navigate({ to: "/settings/general" });
    expect(currentBackLabel(router)).toBe("Pull requests");

    await router.navigate({ to: "/" });
    await router.navigate({ to: "/settings/general" });
    expect(currentBackLabel(router)).toBe("Threads");
  });

  it("says Back when history-back would stay inside settings", async () => {
    const router = createAppRouter("/usage");
    await router.load();
    await router.navigate({ to: "/settings/general" });
    await router.navigate({ to: "/settings/providers" });

    expect(currentBackLabel(router)).toBe("Back");
  });

  it("falls back to the thread list without history, and Back for unknown entries", () => {
    expect(settingsBackLabel(false, undefined)).toBe("Threads");
    expect(settingsBackLabel(true, undefined)).toBe("Back");
  });
});
