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
