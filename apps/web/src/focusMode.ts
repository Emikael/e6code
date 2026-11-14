/**
 * What focus mode (F6) renders, from what is stored. Focus never writes the
 * sidebar, right panel or terminal state; it only overrides what renders, so
 * leaving focus, even after a reload in focus, shows exactly what was stored.
 * The right panel shows during focus only once it was opened there (Mod+D,
 * Review diff, Changes so far).
 */
export interface FocusLayout {
  readonly sidebarOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly terminalOpen: boolean;
}

export function resolveFocusLayout(
  stored: FocusLayout,
  focus: { readonly focusMode: boolean; readonly panelPeek: boolean },
): FocusLayout {
  if (!focus.focusMode) return stored;
  return {
    sidebarOpen: false,
    rightPanelOpen: focus.panelPeek && stored.rightPanelOpen,
    terminalOpen: false,
  };
}

/**
 * Threads whose right panel was closed until focus opened it (Mod+D, Mod+Alt+B,
 * Review diff, a file link). Opening writes the panel's store, so these are
 * closed again once the peek ends or focus exits; otherwise leaving focus
 * would show a panel that was closed before it.
 */
export function recordFocusOpenedPanel(
  keys: ReadonlyArray<string>,
  threadKey: string,
): ReadonlyArray<string> {
  return keys.includes(threadKey) ? keys : [...keys, threadKey];
}

/**
 * The panels to close now: every one focus opened, once nothing peeks any
 * more (the peek was hidden, the thread switched, focus exited, or a reload
 * dropped the peek). While a peek shows, none.
 */
export function focusOpenedPanelsToClose(state: {
  readonly focusMode: boolean;
  readonly focusPanelPeek: boolean;
  readonly focusOpenedPanelKeys: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  return state.focusMode && state.focusPanelPeek ? [] : state.focusOpenedPanelKeys;
}

/**
 * The surface a thread's open panel showed before focus switched it (Mod+D
 * moves an open panel to Diff). The first one recorded wins, so leaving focus
 * shows the surface that was showing when focus began.
 */
export function recordFocusReplacedSurface(
  surfaces: Readonly<Record<string, string>>,
  threadKey: string,
  surfaceId: string,
): Readonly<Record<string, string>> {
  return threadKey in surfaces ? surfaces : { ...surfaces, [threadKey]: surfaceId };
}

/** The surfaces to show again now: all of them once focus has exited, none while it lasts. */
export function focusSurfacesToRestore(state: {
  readonly focusMode: boolean;
  readonly focusReplacedSurfaceByThreadKey: Readonly<Record<string, string>>;
}): ReadonlyArray<readonly [threadKey: string, surfaceId: string]> {
  return state.focusMode ? [] : Object.entries(state.focusReplacedSurfaceByThreadKey);
}
