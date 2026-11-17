/**
 * The clock and phase store behind the per-launch startup record (`DesktopStartupRecorder`).
 *
 * This module must stay the first import of `main.ts` and must import nothing: the bundle
 * evaluates modules in import order, so its body runs before the rest of the main bundle
 * (only the hoisted `require`s of Node built-ins and `electron` come first), and that is
 * where `mainEntry` is stamped. Stamps from code that runs before any
 * Effect runtime exists (`electronReady`) and from plain Electron callbacks (`ready-to-show`)
 * land here directly; the recorder reads the store once it settles.
 *
 * Times are milliseconds since the OS created the process (`process.getCreationTime()`),
 * computed as the monotonic `performance.now()` plus a fixed offset, so intervals between
 * phases stay monotonic even if the wall clock steps. Renderer times arrive as epoch
 * milliseconds and are converted against the same zero.
 */

/** Phases every launch must account for: reached, not applicable, or not reached. */
export const REQUIRED_STARTUP_PHASES = [
  "mainEntry",
  "electronReady",
  "shellEnvironmentImport",
  "settingsLoad",
  "protocolRegistered",
  "mainWindowCreated",
  "mainWindowReadyToShow",
  "rendererFirstPaint",
  "shellInteractive",
  "backendReady",
] as const;

/** Recorded when they happen; they never hold the record back. */
export const OPTIONAL_STARTUP_PHASES = ["rendererFirstContentfulPaint", "rendererLanding"] as const;

export type RequiredStartupPhase = (typeof REQUIRED_STARTUP_PHASES)[number];
export type StartupPhase = RequiredStartupPhase | (typeof OPTIONAL_STARTUP_PHASES)[number];

export type StartupPhaseState =
  | {
      readonly status: "reached";
      readonly atMs: number;
      /** Set for phases that are spans of work, such as the shell environment import. */
      readonly startMs?: number;
      /** `shellInteractive`: the least-synced shell status on screen (`cached`, `synchronizing`, `live`). */
      readonly syncStatus?: string;
      /** `rendererLanding`: which root surface the first route rendered. */
      readonly landing?: string;
    }
  | { readonly status: "not-applicable"; readonly reason: string };

export interface StartupClockOrigin {
  readonly origin: "process-creation" | "node-time-origin";
  readonly processCreatedEpochMs: number | null;
  readonly nodeTimeOriginEpochMs: number;
  /** How long after process creation Node's time origin was; 0 when creation is unknown. */
  readonly nodeTimeOriginOffsetMs: number;
}

export class StartupClock {
  readonly origin: StartupClockOrigin;
  readonly #now: () => number;
  readonly #phases = new Map<StartupPhase, StartupPhaseState>();
  readonly #listeners = new Set<() => void>();

  constructor(input: {
    readonly processCreatedEpochMs: number | null;
    readonly nodeTimeOriginEpochMs: number;
    /** Monotonic milliseconds since Node's time origin. */
    readonly now: () => number;
  }) {
    const known = input.processCreatedEpochMs !== null;
    this.origin = {
      origin: known ? "process-creation" : "node-time-origin",
      processCreatedEpochMs: input.processCreatedEpochMs,
      nodeTimeOriginEpochMs: input.nodeTimeOriginEpochMs,
      nodeTimeOriginOffsetMs: known
        ? input.nodeTimeOriginEpochMs - (input.processCreatedEpochMs ?? 0)
        : 0,
    };
    this.#now = input.now;
  }

  /** Milliseconds since the clock's zero. */
  nowMs(): number {
    return this.#now() + this.origin.nodeTimeOriginOffsetMs;
  }

  /** Converts an epoch timestamp, such as one taken in a renderer, to the clock's zero. */
  fromEpochMs(epochMs: number): number {
    return epochMs - (this.origin.processCreatedEpochMs ?? this.origin.nodeTimeOriginEpochMs);
  }

  /** Stamps a phase as reached now. Only the first stamp of a phase counts. */
  reach(
    phase: StartupPhase,
    detail: {
      readonly startMs?: number;
      readonly syncStatus?: string;
      readonly landing?: string;
    } = {},
    atMs: number = this.nowMs(),
  ): void {
    this.#set(phase, { status: "reached", atMs, ...detail });
  }

  /** Marks a phase that cannot happen in this launch. Only the first stamp of a phase counts. */
  notApplicable(phase: StartupPhase, reason: string): void {
    this.#set(phase, { status: "not-applicable", reason });
  }

  get(phase: StartupPhase): StartupPhaseState | undefined {
    return this.#phases.get(phase);
  }

  /** Calls `listener` after every phase change until the returned function is called. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(phase: StartupPhase, state: StartupPhaseState): void {
    if (this.#phases.has(phase)) return;
    this.#phases.set(phase, state);
    for (const listener of this.#listeners) listener();
  }
}

function readProcessCreatedEpochMs(): number | null {
  // Electron adds `getCreationTime` to the main process; plain Node (tests) lacks it.
  const electronProcess = process as { getCreationTime?: () => number | null };
  return typeof electronProcess.getCreationTime === "function"
    ? electronProcess.getCreationTime()
    : null;
}

/** The main process's clock. */
export const startupClock = new StartupClock({
  processCreatedEpochMs: readProcessCreatedEpochMs(),
  nodeTimeOriginEpochMs: performance.timeOrigin,
  now: () => performance.now(),
});
startupClock.reach("mainEntry");
