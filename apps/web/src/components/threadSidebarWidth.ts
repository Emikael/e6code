export const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_DEFAULT_WIDTH = 16 * 16;
export const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
export const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function resolveThreadSidebarMaximumWidth(viewportWidth: number): number {
  return Math.max(
    THREAD_SIDEBAR_MIN_WIDTH,
    Math.floor(viewportWidth) - THREAD_MAIN_CONTENT_MIN_WIDTH,
  );
}

export const SWITCHBOARD_COLUMN_MIN_WIDTH = 256;
export const SWITCHBOARD_COLUMN_MAX_WIDTH = 420;
export const SWITCHBOARD_RAIL_WIDTH = 60;
export const SWITCHBOARD_SIDEBAR_WIDTH_STORAGE_KEY = "switchboard_column_width";

export function resolveSwitchboardColumnWidth(
  storedColumnWidth: number | null,
  viewportWidth: number,
): number {
  const fallback = viewportWidth >= 1440 ? 324 : viewportWidth >= 1280 ? 300 : 272;
  const preferred = storedColumnWidth === null ? fallback : storedColumnWidth;
  const available =
    Math.floor(viewportWidth) - THREAD_MAIN_CONTENT_MIN_WIDTH - SWITCHBOARD_RAIL_WIDTH;
  const viewportCap = Math.max(SWITCHBOARD_COLUMN_MIN_WIDTH, available);
  return Math.min(
    SWITCHBOARD_COLUMN_MAX_WIDTH,
    viewportCap,
    Math.max(SWITCHBOARD_COLUMN_MIN_WIDTH, preferred),
  );
}

export function resolveInitialThreadSidebarWidth(
  storedWidth: number | null,
  viewportWidth: number,
): number {
  const preferredWidth =
    storedWidth === null
      ? THREAD_SIDEBAR_DEFAULT_WIDTH
      : Math.max(THREAD_SIDEBAR_MIN_WIDTH, storedWidth);
  return Math.min(preferredWidth, resolveThreadSidebarMaximumWidth(viewportWidth));
}
