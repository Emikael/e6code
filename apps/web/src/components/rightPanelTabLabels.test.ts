import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";
import {
  closeTabKeyShortcuts,
  overflowMenuLabel,
  runningTerminalCount,
  surfaceTitle,
  surfaceTitleParts,
  tabsOutOfView,
} from "./rightPanelTabLabels";

const NO_SESSIONS = {};
const NO_LABELS = new Map<string, string>();

const diff: RightPanelSurface = { id: "diff", kind: "diff" };
const terminal: RightPanelSurface = {
  id: "terminal:term-1",
  kind: "terminal",
  resourceId: "term-1",
  terminalIds: ["term-1", "term-2"],
  activeTerminalId: "term-1",
};
const pullRequest = {
  id: "pull-request:p:acme/app#412",
  kind: "pull-request",
  projectId: "p",
  repository: "acme/app",
  number: 412,
} as Extract<RightPanelSurface, { kind: "pull-request" }>;

describe("surfaceTitle", () => {
  it("counts changed files on the Diff tab, and drops the count at zero", () => {
    expect(surfaceTitle(diff, NO_SESSIONS, NO_LABELS, { changedFileCount: 5 })).toBe(
      "Diff · 5 files",
    );
    expect(surfaceTitle(diff, NO_SESSIONS, NO_LABELS, { changedFileCount: 1 })).toBe(
      "Diff · 1 file",
    );
    expect(surfaceTitle(diff, NO_SESSIONS, NO_LABELS, { changedFileCount: 0 })).toBe("Diff");
  });

  it("names a pull request's state once it is known", () => {
    expect(surfaceTitle(pullRequest, NO_SESSIONS, NO_LABELS)).toBe("#412");
    expect(
      surfaceTitle(pullRequest, NO_SESSIONS, NO_LABELS, {
        pullRequestStatus: { state: "open", isDraft: false },
      }),
    ).toBe("#412 · Open");
    expect(
      surfaceTitle(pullRequest, NO_SESSIONS, NO_LABELS, {
        pullRequestStatus: { state: "open", isDraft: true },
      }),
    ).toBe("#412 · Draft");
    // A stale draft flag does not outrank a finished lifecycle.
    expect(
      surfaceTitle(pullRequest, NO_SESSIONS, NO_LABELS, {
        pullRequestStatus: { state: "merged", isDraft: true },
      }),
    ).toBe("#412 · Merged");
  });

  it("says how many of a terminal tab's panes are running, or that one finished", () => {
    const labels = new Map([["term-1", "dev server"]]);
    expect(surfaceTitle(terminal, NO_SESSIONS, labels)).toBe("Terminal");
    expect(
      surfaceTitle(terminal, NO_SESSIONS, labels, {
        runningTerminalIds: new Set(["term-2", "term-9"]),
      }),
    ).toBe("Terminal · 1 running");
    expect(
      surfaceTitle(terminal, NO_SESSIONS, labels, {
        finishedTerminalIds: new Set(["term-1"]),
      }),
    ).toBe("Terminal · Finished");
    // Running wins: the tab keeps the process that still needs watching in view.
    expect(
      surfaceTitle(terminal, NO_SESSIONS, labels, {
        runningTerminalIds: new Set(["term-2"]),
        finishedTerminalIds: new Set(["term-1"]),
      }),
    ).toBe("Terminal · 1 running");
  });

  it("calls the pull request list Pull requests", () => {
    expect(
      surfaceTitle({ id: "pull-requests", kind: "pull-requests" }, NO_SESSIONS, NO_LABELS),
    ).toBe("Pull requests");
  });
});

describe("surfaceTitleParts", () => {
  it("keeps the state apart from the name, so truncating the name never drops it", () => {
    expect(
      surfaceTitleParts(terminal, NO_SESSIONS, new Map([["term-1", "a very long dev server"]]), {
        runningTerminalIds: new Set(["term-1"]),
      }),
    ).toEqual({ name: "Terminal", state: "1 running" });
    expect(
      surfaceTitleParts(pullRequest, NO_SESSIONS, NO_LABELS, {
        pullRequestStatus: { state: "open", isDraft: false },
      }),
    ).toEqual({ name: "#412", state: "Open" });
    expect(surfaceTitleParts(diff, NO_SESSIONS, NO_LABELS)).toEqual({ name: "Diff", state: null });
  });
});

describe("runningTerminalCount", () => {
  it("counts only the tab's own running panes", () => {
    expect(runningTerminalCount(terminal, new Set(["term-1", "term-2", "term-3"]))).toBe(2);
    expect(runningTerminalCount(terminal, undefined)).toBe(0);
    expect(runningTerminalCount(diff, new Set(["term-1"]))).toBe(0);
  });
});

describe("tabsOutOfView", () => {
  const tabs = [
    { id: "run-details", start: 0, end: 90 },
    { id: "diff", start: 92, end: 200 },
    { id: "terminal", start: 202, end: 320 },
    { id: "files", start: 322, end: 400 },
  ];

  it("lists nothing when every tab fits", () => {
    expect(tabsOutOfView(tabs, 0, 400)).toEqual([]);
  });

  it("lists tabs cut by either edge, in tab order", () => {
    expect(tabsOutOfView(tabs, 0, 250)).toEqual(["terminal", "files"]);
    expect(tabsOutOfView(tabs, 100, 400)).toEqual(["run-details", "diff"]);
  });

  it("ignores sub-pixel overhang", () => {
    expect(tabsOutOfView(tabs, 0.5, 399.5)).toEqual([]);
  });
});

describe("overflowMenuLabel", () => {
  it("counts the hidden tabs and names a running one", () => {
    expect(overflowMenuLabel(3, 0)).toEqual({ text: "3 more", ariaLabel: "3 more tabs" });
    expect(overflowMenuLabel(5, 1)).toEqual({
      text: "5 more · 1 running",
      ariaLabel: "5 more tabs, 1 running",
    });
    expect(overflowMenuLabel(1, 0).ariaLabel).toBe("1 more tab");
  });
});

describe("closeTabKeyShortcuts", () => {
  const modW = {
    key: "w",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: true,
  };

  it("names Delete and Backspace, then the close shortcut for the platform", () => {
    expect(closeTabKeyShortcuts(modW, "MacIntel")).toBe("Delete Backspace Meta+W");
    expect(closeTabKeyShortcuts(modW, "Win32")).toBe("Delete Backspace Control+W");
  });

  it("leaves the shortcut out when none is bound", () => {
    expect(closeTabKeyShortcuts(null, "MacIntel")).toBe("Delete Backspace");
  });
});
