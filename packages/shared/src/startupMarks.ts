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
 * How far the shell's data had synced when it became interactive: the least-synced status
 * among the environments showing a snapshot. `cached` means a snapshot restored from the
 * client cache was on screen; `synchronizing`, a snapshot not yet confirmed live.
 */
export type StartupShellSource = "cached" | "synchronizing" | "live";

const LANDINGS: ReadonlySet<string> = new Set<StartupLanding>([
  "app",
  "welcome",
  "pair",
  "requires-auth",
]);
const SHELL_SOURCES: ReadonlyArray<StartupShellSource> = ["cached", "synchronizing", "live"];

export const startupLandingMark = (landing: StartupLanding): string =>
  `${STARTUP_MARK_PREFIX}landing:${landing}`;

export const startupShellInteractiveMark = (source: StartupShellSource): string =>
  `${STARTUP_MARK_PREFIX}shell-interactive:${source}`;

/**
 * Classifies the shell's data, one entry per enabled environment; `null` while no
 * environment has a snapshot to show, so the shell is not yet interactive.
 */
export function resolveStartupShellSource(
  environments: ReadonlyArray<{ readonly hasSnapshot: boolean; readonly status: string }>,
): StartupShellSource | null {
  let leastSynced: number | null = null;
  for (const environment of environments) {
    if (!environment.hasSnapshot) continue;
    const rank = SHELL_SOURCES.indexOf(environment.status as StartupShellSource);
    // A snapshot under any other status has not been confirmed by the server yet.
    const effectiveRank = rank === -1 ? 0 : rank;
    leastSynced = leastSynced === null ? effectiveRank : Math.min(leastSynced, effectiveRank);
  }
  return leastSynced === null ? null : (SHELL_SOURCES[leastSynced] ?? null);
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
  if (kind === "shell-interactive" && SHELL_SOURCES.includes(value as StartupShellSource)) {
    return { kind, source: value as StartupShellSource };
  }
  return null;
}
