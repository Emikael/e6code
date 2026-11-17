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
 * The least-synced shell status among the environments showing a snapshot when the shell
 * became interactive, in the shell state's own terms. It describes connection progress,
 * not where the snapshot came from: a snapshot restored from the client cache reads
 * `synchronizing` as soon as its environment starts connecting.
 */
export type StartupShellSyncStatus = "cached" | "synchronizing" | "live";

const LANDINGS: ReadonlySet<string> = new Set<StartupLanding>([
  "app",
  "welcome",
  "pair",
  "requires-auth",
]);
const SHELL_SYNC_STATUSES: ReadonlyArray<StartupShellSyncStatus> = [
  "cached",
  "synchronizing",
  "live",
];

export const startupLandingMark = (landing: StartupLanding): string =>
  `${STARTUP_MARK_PREFIX}landing:${landing}`;

export const startupShellInteractiveMark = (syncStatus: StartupShellSyncStatus): string =>
  `${STARTUP_MARK_PREFIX}shell-interactive:${syncStatus}`;

/**
 * Classifies the shell's data, one entry per enabled environment; `null` while no
 * environment has a snapshot to show, so the shell is not yet interactive.
 */
export function resolveStartupShellSyncStatus(
  environments: ReadonlyArray<{
    readonly hasSnapshot: boolean;
    readonly status: StartupShellSyncStatus | "empty";
  }>,
): StartupShellSyncStatus | null {
  let leastSynced: number | null = null;
  for (const environment of environments) {
    if (!environment.hasSnapshot) continue;
    // `empty` never holds a snapshot; rank it with `cached` if it ever does.
    const effectiveRank = Math.max(
      0,
      SHELL_SYNC_STATUSES.indexOf(environment.status as StartupShellSyncStatus),
    );
    leastSynced = leastSynced === null ? effectiveRank : Math.min(leastSynced, effectiveRank);
  }
  return leastSynced === null ? null : (SHELL_SYNC_STATUSES[leastSynced] ?? null);
}

export type ParsedStartupMark =
  | { readonly kind: "landing"; readonly landing: StartupLanding }
  | { readonly kind: "shell-interactive"; readonly syncStatus: StartupShellSyncStatus };

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
  if (
    kind === "shell-interactive" &&
    SHELL_SYNC_STATUSES.includes(value as StartupShellSyncStatus)
  ) {
    return { kind, syncStatus: value as StartupShellSyncStatus };
  }
  return null;
}
