// Lets the command palette trigger sidebar-owned bulk actions without owning
// the sidebar's thread state. Mirrors commandPaletteBus.
const SIDEBAR_ACTION_EVENT = "e6code:sidebar-action";

export type SidebarAction = "archive-settled" | "delete-settled";

export function requestSidebarAction(action: SidebarAction): void {
  window.dispatchEvent(new CustomEvent(SIDEBAR_ACTION_EVENT, { detail: action }));
}

export function onSidebarAction(listener: (action: SidebarAction) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<SidebarAction>).detail);
  window.addEventListener(SIDEBAR_ACTION_EVENT, handler);
  return () => window.removeEventListener(SIDEBAR_ACTION_EVENT, handler);
}
