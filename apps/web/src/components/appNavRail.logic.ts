/** The app-level destinations the navigation rail offers. */
export type AppNavDestination = "threads" | "pull-requests" | "usage" | "settings";

/**
 * Whether a route shows the slim navigation rail in place of the thread sidebar. Only the
 * app-level pages that are not about one thread get it; threads, drafts, projects and settings
 * keep their own sidebar.
 */
export function showsAppNavRail(pathname: string): boolean {
  return /^\/(?:pull-requests|usage)\/?$/.test(pathname);
}

/** Which rail destination a route belongs to, so its button can mark the current page. */
export function appNavDestinationOf(pathname: string): AppNavDestination | null {
  if (/^\/pull-requests\/?$/.test(pathname)) return "pull-requests";
  if (/^\/usage\/?$/.test(pathname)) return "usage";
  if (/^\/settings(?:\/|$)/.test(pathname)) return "settings";
  if (pathname === "/" || /^\/(?:draft|projects)\//.test(pathname)) return "threads";
  // Thread routes are /<environmentId>/<threadId>.
  if (/^\/[^/]+\/[^/]+\/?$/.test(pathname)) return "threads";
  return null;
}
