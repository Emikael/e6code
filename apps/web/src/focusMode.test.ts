import { describe, expect, it } from "vite-plus/test";

import { resolveFocusLayout } from "./focusMode";
import {
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
