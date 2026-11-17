/**
 * `performance.mark` names the web client sets while it boots. The desktop preload forwards
 * every mark under this prefix to the main process, which folds them into the per-launch
 * startup record; browsers and the web performance harness can read them as ordinary marks.
 *
 * Values ride in the mark name rather than in `detail`, so they survive the hop from the
 * page's world into the preload's isolated world unchanged.
 */
export const STARTUP_MARK_PREFIX = "e6:startup:";

/**
 * Which root surface the first route rendered. Only `app` goes on to show the shell.
 * `starting` is the desktop panel shown while the local environment starts with nothing to
 * show yet; the shell or the wizard follows it, and marks its own landing.
 */
export type StartupLanding = "app" | "welcome" | "pair" | "requires-auth" | "starting";

/**
 * The least-synced shell status among the environments showing a snapshot when the shell
 * became interactive, in the shell state's own terms. It describes connection progress,
 * not where the snapshot came from: a snapshot restored from the client cache reads
 * `synchronizing` as soon as its environment starts connecting.
 */
export type StartupShellSyncStatus = "cached" | "synchronizing" | "live";

/**
 * Where the snapshots on screen came from when the shell became interactive: `cache` when any
 * of them was restored from the client cache, `server` when all came from a server.
 */
export type StartupShellSnapshotSource = "cache" | "server";

const LANDINGS: ReadonlySet<string> = new Set<StartupLanding>([
  "app",
  "welcome",
  "pair",
  "requires-auth",
  "starting",
]);
const SNAPSHOT_SOURCES: ReadonlySet<string> = new Set<StartupShellSnapshotSource>([
  "cache",
  "server",
]);
const SHELL_LIVE_MARK = `${STARTUP_MARK_PREFIX}shell-live`;
const SHELL_SYNC_STATUSES: ReadonlyArray<StartupShellSyncStatus> = [
  "cached",
  "synchronizing",
  "live",
];

export const startupLandingMark = (landing: StartupLanding): string =>
  `${STARTUP_MARK_PREFIX}landing:${landing}`;

export const startupShellInteractiveMark = (
  syncStatus: StartupShellSyncStatus,
  source?: StartupShellSnapshotSource,
): string =>
  `${STARTUP_MARK_PREFIX}shell-interactive:${syncStatus}${source === undefined ? "" : `:${source}`}`;

/** The first frame in which the primary environment's shell is live. */
export const startupShellLiveMark = (): string => SHELL_LIVE_MARK;

/** `cache` when any environment showing a snapshot shows a cached one; `null` with none. */
export function resolveStartupShellSnapshotSource(
  environments: ReadonlyArray<{
    readonly hasSnapshot: boolean;
    readonly snapshotSource: StartupShellSnapshotSource | undefined;
  }>,
): StartupShellSnapshotSource | null {
  let source: StartupShellSnapshotSource | null = null;
  for (const environment of environments) {
    if (!environment.hasSnapshot) continue;
    // A snapshot without a recorded source predates tracking it; only a server sets one late.
    if (environment.snapshotSource !== "server") return "cache";
    source = "server";
  }
  return source;
}

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
  | {
      readonly kind: "shell-interactive";
      readonly syncStatus: StartupShellSyncStatus;
      /** Absent on marks from builds that predate it. */
      readonly source?: StartupShellSnapshotSource;
    }
  | { readonly kind: "shell-live" };

/** Reads a mark set with one of the builders above, old forms included; anything else is `null`. */
export function parseStartupMark(name: string): ParsedStartupMark | null {
  if (name === SHELL_LIVE_MARK) return { kind: "shell-live" };
  if (!name.startsWith(STARTUP_MARK_PREFIX)) return null;
  const separator = name.indexOf(":", STARTUP_MARK_PREFIX.length);
  if (separator === -1) return null;
  const kind = name.slice(STARTUP_MARK_PREFIX.length, separator);
  const value = name.slice(separator + 1);
  if (kind === "landing" && LANDINGS.has(value)) {
    return { kind, landing: value as StartupLanding };
  }
  if (kind === "shell-interactive") {
    const [syncStatus, source, ...rest] = value.split(":");
    if (
      rest.length > 0 ||
      !SHELL_SYNC_STATUSES.includes(syncStatus as StartupShellSyncStatus) ||
      (source !== undefined && !SNAPSHOT_SOURCES.has(source))
    ) {
      return null;
    }
    return {
      kind,
      syncStatus: syncStatus as StartupShellSyncStatus,
      ...(source === undefined ? {} : { source: source as StartupShellSnapshotSource }),
    };
  }
  return null;
}
