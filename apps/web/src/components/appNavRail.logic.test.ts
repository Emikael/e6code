import { describe, expect, it } from "vite-plus/test";

import { appNavDestinationOf, showsAppNavRail } from "./appNavRail.logic";

describe("showsAppNavRail", () => {
  it("swaps the sidebar for the rail on the pull requests and usage pages", () => {
    expect(showsAppNavRail("/pull-requests")).toBe(true);
    expect(showsAppNavRail("/pull-requests/")).toBe(true);
    expect(showsAppNavRail("/usage")).toBe(true);
  });

  it("keeps the thread sidebar and settings nav everywhere else", () => {
    expect(showsAppNavRail("/")).toBe(false);
    expect(showsAppNavRail("/env-1/thread-1")).toBe(false);
    expect(showsAppNavRail("/draft/draft-1")).toBe(false);
    expect(showsAppNavRail("/settings")).toBe(false);
    expect(showsAppNavRail("/settings/general")).toBe(false);
    expect(showsAppNavRail("/usage-report")).toBe(false);
    expect(showsAppNavRail("/pull-requests/extra")).toBe(false);
  });
});

describe("appNavDestinationOf", () => {
  it("marks the page each rail button leads to", () => {
    expect(appNavDestinationOf("/pull-requests")).toBe("pull-requests");
    expect(appNavDestinationOf("/usage")).toBe("usage");
    expect(appNavDestinationOf("/settings")).toBe("settings");
    expect(appNavDestinationOf("/settings/keybindings")).toBe("settings");
  });

  it("treats the thread pages as Threads", () => {
    expect(appNavDestinationOf("/")).toBe("threads");
    expect(appNavDestinationOf("/env-1/thread-1")).toBe("threads");
    expect(appNavDestinationOf("/draft/draft-1")).toBe("threads");
    expect(appNavDestinationOf("/projects/key")).toBe("threads");
  });

  it("marks nothing on pages the rail does not name", () => {
    expect(appNavDestinationOf("/welcome")).toBeNull();
    expect(appNavDestinationOf("/settingsx")).toBeNull();
  });
});
