/**
 * `performance.mark` names the web client sets while it boots. The desktop preload forwards
 * every mark under this prefix to the main process, which folds them into the per-launch
 * startup record; browsers and the web performance harness can read them as ordinary marks.
 *
 * Values ride in the mark name rather than in `detail`, so they survive the hop from the
 * page's world into the preload's isolated world unchanged.
 */
export const STARTUP_MARK_PREFIX = "e6:startup:";

/** Which root surface the first route rendered. Only `app` goes on to show the shell. */
export type StartupLanding = "app" | "welcome" | "pair" | "requires-auth";

/**
 * Where the shell's data came from when it became interactive: `cache` when any environment
 * was still showing its cached snapshot, `live` when every shown snapshot was live, `none`
 * when no environment had a snapshot to show.
 */
export type StartupShellSource = "cache" | "live" | "none";

const LANDINGS: ReadonlySet<string> = new Set<StartupLanding>([
  "app",
  "welcome",
  "pair",
  "requires-auth",
]);
const SHELL_SOURCES: ReadonlySet<string> = new Set<StartupShellSource>(["cache", "live", "none"]);

export const startupLandingMark = (landing: StartupLanding): string =>
  `${STARTUP_MARK_PREFIX}landing:${landing}`;

export const startupShellInteractiveMark = (source: StartupShellSource): string =>
  `${STARTUP_MARK_PREFIX}shell-interactive:${source}`;

/** Classifies the shell's data at the moment it became interactive, one entry per environment. */
export function resolveStartupShellSource(
  environments: ReadonlyArray<{ readonly hasSnapshot: boolean; readonly live: boolean }>,
): StartupShellSource {
  const shown = environments.filter((environment) => environment.hasSnapshot);
  if (shown.length === 0) return "none";
  return shown.every((environment) => environment.live) ? "live" : "cache";
}

export type ParsedStartupMark =
  | { readonly kind: "landing"; readonly landing: StartupLanding }
  | { readonly kind: "shell-interactive"; readonly source: StartupShellSource };

/** Reads a mark set with one of the builders above; anything else is `null`. */
export function parseStartupMark(name: string): ParsedStartupMark | null {
  if (!name.startsWith(STARTUP_MARK_PREFIX)) return null;
  const separator = name.indexOf(":", STARTUP_MARK_PREFIX.length);
  if (separator === -1) return null;
  const kind = name.slice(STARTUP_MARK_PREFIX.length, separator);
  const value = name.slice(separator + 1);
  if (kind === "landing" && LANDINGS.has(value)) {
    return { kind, landing: value as StartupLanding };
  }
  if (kind === "shell-interactive" && SHELL_SOURCES.has(value)) {
    return { kind, source: value as StartupShellSource };
  }
  return null;
}
