import { describe, expect, it } from "vite-plus/test";

import { focusOpenedPanelsToClose, focusSurfacesToRestore, resolveFocusLayout } from "./focusMode";
import {
  clearFocusOpenedPanels,
  clearFocusReplacedSurfaces,
  noteFocusOpenedPanel,
  noteFocusReplacedSurface,
  parsePersistedState,
  setFocusMode,
  setFocusPanelPeek,
  type PersistedUiState,
  type UiState,
} from "./uiStateStore";

const stored = { sidebarOpen: true, rightPanelOpen: true, terminalOpen: true };

describe("resolveFocusLayout", () => {
  it("renders the sidebar, right panel and terminal closed while focus is on", () => {
    expect(resolveFocusLayout(stored, { focusMode: true, panelPeek: false })).toEqual({
      sidebarOpen: false,
      rightPanelOpen: false,
      terminalOpen: false,
    });
  });

  it("shows the right panel in focus only once it was opened there", () => {
    expect(resolveFocusLayout(stored, { focusMode: true, panelPeek: true }).rightPanelOpen).toBe(
      true,
    );
    expect(
      resolveFocusLayout({ ...stored, rightPanelOpen: false }, { focusMode: true, panelPeek: true })
        .rightPanelOpen,
    ).toBe(false);
  });

  it("restores exactly what was stored on exit", () => {
    const layouts = [
      stored,
      { sidebarOpen: false, rightPanelOpen: true, terminalOpen: false },
      { sidebarOpen: true, rightPanelOpen: false, terminalOpen: true },
    ];
    for (const layout of layouts) {
      expect(resolveFocusLayout(layout, { focusMode: false, panelPeek: false })).toBe(layout);
    }
  });
});

describe("focus state", () => {
  const base = parsePersistedState({});

  it("survives a reload in focus, with the panel hidden again", () => {
    const inFocus = setFocusPanelPeek(setFocusMode(base, true), true);
    const persisted: PersistedUiState = { focusMode: inFocus.focusMode };
    const reloaded = parsePersistedState(JSON.parse(JSON.stringify(persisted)));
    expect(reloaded.focusMode).toBe(true);
    expect(reloaded.focusPanelPeek).toBe(false);
    const exited = setFocusMode(reloaded, false);
    expect(resolveFocusLayout(stored, { focusMode: exited.focusMode, panelPeek: false })).toBe(
      stored,
    );
  });

  it("only peeks while in focus, and entering or leaving resets the peek", () => {
    expect(setFocusPanelPeek(base, true)).toBe(base);
    const peeking: UiState = setFocusPanelPeek(setFocusMode(base, true), true);
    expect(peeking.focusPanelPeek).toBe(true);
    expect(setFocusMode(peeking, false).focusPanelPeek).toBe(false);
  });

  it("ignores a malformed stored value", () => {
    expect(parsePersistedState({ focusMode: "yes" as unknown as boolean }).focusMode).toBe(false);
  });
});

describe("panels focus opened", () => {
  const inFocus = setFocusMode(parsePersistedState({}), true);

  it("closes a panel focus opened once the peek ends, and keeps one that was open before", () => {
    // Mod+D on a thread whose panel was closed: it peeks and is remembered.
    const peeking = noteFocusOpenedPanel(inFocus, "env:a");
    expect(peeking.focusPanelPeek).toBe(true);
    expect(focusOpenedPanelsToClose(peeking)).toEqual([]);
    // Hiding the peek, or leaving focus, closes it again.
    const hidden = setFocusPanelPeek(peeking, false);
    expect(focusOpenedPanelsToClose(hidden)).toEqual(["env:a"]);
    expect(focusOpenedPanelsToClose(setFocusMode(peeking, false))).toEqual(["env:a"]);
    expect(clearFocusOpenedPanels(hidden, ["env:a"]).focusOpenedPanelKeys).toEqual([]);
    // A panel that was already open only peeks; nothing is recorded to close.
    expect(
      focusOpenedPanelsToClose(setFocusPanelPeek(setFocusPanelPeek(inFocus, true), false)),
    ).toEqual([]);
  });

  it("still closes them after a reload in focus", () => {
    const peeking = noteFocusOpenedPanel(inFocus, "env:a");
    const persisted: PersistedUiState = {
      focusMode: peeking.focusMode,
      focusOpenedPanelKeys: [...peeking.focusOpenedPanelKeys],
    };
    const reloaded = parsePersistedState(JSON.parse(JSON.stringify(persisted)));
    expect(focusOpenedPanelsToClose(reloaded)).toEqual(["env:a"]);
  });

  it("records nothing outside focus", () => {
    const base = parsePersistedState({});
    expect(noteFocusOpenedPanel(base, "env:a")).toBe(base);
  });
});

describe("surfaces focus switched", () => {
  const inFocus = setFocusMode(parsePersistedState({}), true);

  it("shows the surface from when focus began once focus exits", () => {
    // Mod+D moved an open panel from Files to Diff, then a tab click moved it again.
    const switched = noteFocusReplacedSurface(
      noteFocusReplacedSurface(inFocus, "env:a", "files"),
      "env:a",
      "diff",
    );
    expect(focusSurfacesToRestore(switched)).toEqual([]);
    const exited = setFocusMode(switched, false);
    expect(focusSurfacesToRestore(exited)).toEqual([["env:a", "files"]]);
    expect(clearFocusReplacedSurfaces(exited, ["env:a"]).focusReplacedSurfaceByThreadKey).toEqual(
      {},
    );
  });

  it("records nothing outside focus", () => {
    const base = parsePersistedState({});
    expect(noteFocusReplacedSurface(base, "env:a", "files")).toBe(base);
  });
});
