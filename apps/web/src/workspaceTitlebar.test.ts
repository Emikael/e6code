import { describe, expect, it } from "vite-plus/test";

import { sidebarReopenControlShows, workspaceTopBarShows } from "./workspaceTitlebar";

describe("sidebarReopenControlShows", () => {
  it("shows while the sidebar is collapsed, and always in a narrow window", () => {
    expect(sidebarReopenControlShows({ isMobile: false, state: "expanded" })).toBe(false);
    expect(sidebarReopenControlShows({ isMobile: false, state: "collapsed" })).toBe(true);
    expect(sidebarReopenControlShows({ isMobile: true, state: "expanded" })).toBe(true);
  });
});

describe("workspaceTopBarShows", () => {
  const emptyWebBar = {
    electron: false,
    hasContent: false,
    isMobile: false,
    state: "expanded",
  } as const;

  it("hides an empty bar on the web beside an open sidebar", () => {
    expect(workspaceTopBarShows(emptyWebBar)).toBe(false);
  });

  it("keeps the bar when it has something to show", () => {
    expect(workspaceTopBarShows({ ...emptyWebBar, hasContent: true })).toBe(true);
  });

  it("keeps the bar as room for the sidebar's reopen control", () => {
    expect(workspaceTopBarShows({ ...emptyWebBar, state: "collapsed" })).toBe(true);
    expect(workspaceTopBarShows({ ...emptyWebBar, isMobile: true })).toBe(true);
  });

  it("always keeps the bar in the desktop app, where it is the window's drag strip", () => {
    expect(workspaceTopBarShows({ ...emptyWebBar, electron: true })).toBe(true);
  });
});
