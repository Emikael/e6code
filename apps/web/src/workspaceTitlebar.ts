import type { ResponsiveSidebarState } from "./components/ui/sidebarState";

export const COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS =
  "[[data-sidebar-state=collapsed]_&]:pl-[var(--workspace-titlebar-content-left)] max-md:[[data-sidebar-state=expanded]_&]:pl-[var(--workspace-titlebar-content-left)]";

interface SidebarPresence {
  readonly isMobile: boolean;
  readonly state: ResponsiveSidebarState;
}

/**
 * Whether the window-edge control that reopens the sidebar shows. It floats over the top bar:
 * while the sidebar shows, its own header carries the toggle; narrow windows keep the control,
 * since the sidebar there is a sheet it opens.
 */
export function sidebarReopenControlShows({ isMobile, state }: SidebarPresence): boolean {
  return isMobile || state !== "expanded";
}

/**
 * Whether a page's top bar is drawn. The desktop app always keeps it: the window needs the drag
 * strip and, on macOS, room for the traffic-light buttons. On the web a bar with nothing in it
 * only pushes the page down, unless it is holding room for the sidebar's reopen control.
 */
export function workspaceTopBarShows(
  input: SidebarPresence & { readonly electron: boolean; readonly hasContent: boolean },
): boolean {
  return input.electron || input.hasContent || sidebarReopenControlShows(input);
}
