import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@e6tools/contracts";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

// Tiny event bus allowing components to programmatically open the command palette
// without owning its React state.
const COMMAND_PALETTE_OPEN_EVENT = "e6code:open-command-palette";

export interface CommandPaletteOpenDetail {
  readonly open?: "add-project" | "new-thread-in";
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
}

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  );
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {});
  };
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}

let afterCloseAction: (() => void) | undefined;

/**
 * Runs `action` once the palette has closed and released its focus trap, in place of returning
 * focus to the composer. For commands that open another popup or move focus themselves.
 */
export function runAfterCommandPaletteCloses(action: () => void): void {
  afterCloseAction = action;
}

/** Read by the palette at its focus restoration milestone. */
export function takeCommandPaletteCloseAction(): (() => void) | undefined {
  const action = afterCloseAction;
  afterCloseAction = undefined;
  return action;
}

const REOPEN_CLOSED_VIEW_EVENT = "e6code:reopen-closed-view";
const OPEN_RIGHT_PANEL_NEW_MENU_EVENT = "e6code:open-right-panel-new-menu";

/** Asks the mounted reopen handler to restore the most recently closed tab. */
export function requestReopenClosedView(): void {
  window.dispatchEvent(new Event(REOPEN_CLOSED_VIEW_EVENT));
}

export function onReopenClosedViewRequest(listener: () => void): () => void {
  window.addEventListener(REOPEN_CLOSED_VIEW_EVENT, listener);
  return () => window.removeEventListener(REOPEN_CLOSED_VIEW_EVENT, listener);
}

/** Asks the open right panel to show its new-tab menu, as Mod+T does. */
export function requestRightPanelNewMenu(): void {
  window.dispatchEvent(new Event(OPEN_RIGHT_PANEL_NEW_MENU_EVENT));
}

export function onRightPanelNewMenuRequest(listener: () => void): () => void {
  window.addEventListener(OPEN_RIGHT_PANEL_NEW_MENU_EVENT, listener);
  return () => window.removeEventListener(OPEN_RIGHT_PANEL_NEW_MENU_EVENT, listener);
}
