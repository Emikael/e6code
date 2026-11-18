import { parseStartupMark } from "@e6tools/shared/startupMarks";

import {
  OPTIONAL_STARTUP_PHASES,
  REQUIRED_STARTUP_PHASES,
  type StartupClock,
  type StartupClockOrigin,
  type StartupPhase,
  type StartupPhaseState,
} from "./DesktopStartupClock.ts";

/**
 * Shape of the lines in `<logDir>/desktop-startup.ndjson`: one `desktop-startup` record per
 * launch, plus a `desktop-startup-memory` line at each memory sample. Consumers ignore keys
 * they do not know; renaming or removing one bumps `version`.
 */
export const STARTUP_RECORD_VERSION = 1;
export const STARTUP_RECORD_FILE_NAME = "desktop-startup.ndjson";
/** Above the backend supervisor's one-minute readiness budget, so a slow backend still lands. */
export const STARTUP_RECORD_DEADLINE_MS = 120_000;
export const STARTUP_MEMORY_SAMPLE_TIMES_MS = [10_000, 60_000] as const;

/** Why the record was written: every required phase resolved, the deadline passed, or the app quit. */
export type StartupRecordOutcome = "settled" | "deadline" | "shutdown";

export type StartupPhaseRecord =
  | StartupPhaseState
  | { readonly status: "not-reached"; readonly reason: StartupRecordOutcome };

export interface StartupRecordContext {
  readonly runId: string;
  readonly pid: number;
  readonly app: {
    readonly version: string;
    readonly platform: string;
    readonly arch: string;
    readonly isPackaged: boolean;
    readonly isDevelopment: boolean;
  };
  readonly launch: {
    readonly localEnvironmentEnabled: boolean;
    readonly wslOnly: boolean;
    readonly wslBackendEnabled: boolean;
    /** The primary's environment id was known before it started, so a cached shell could show. */
    readonly environmentIdKnown: boolean;
  };
}

export interface StartupRecord extends StartupRecordContext {
  readonly type: "desktop-startup";
  readonly version: typeof STARTUP_RECORD_VERSION;
  readonly clock: StartupClockOrigin;
  readonly outcome: StartupRecordOutcome;
  readonly writtenAtMs: number;
  readonly phases: Readonly<Record<StartupPhase, StartupPhaseRecord>>;
}

/**
 * Every required phase is resolved, and once the shell is interactive and the backend is ready
 * the primary's shell has also gone live: the step from ready to live is what the record shows
 * for that launch. A launch that never goes live is written at the deadline.
 */
export const isStartupSettled = (clock: StartupClock): boolean =>
  REQUIRED_STARTUP_PHASES.every((phase) => clock.get(phase) !== undefined) &&
  (clock.get("shellLive") !== undefined ||
    clock.get("backendReady")?.status !== "reached" ||
    clock.get("shellInteractive")?.status !== "reached");

export function buildStartupRecord(input: {
  readonly context: StartupRecordContext;
  readonly clock: StartupClock;
  readonly outcome: StartupRecordOutcome;
}): StartupRecord {
  const phases = {} as Record<StartupPhase, StartupPhaseRecord>;
  for (const phase of [...REQUIRED_STARTUP_PHASES, ...OPTIONAL_STARTUP_PHASES]) {
    phases[phase] = input.clock.get(phase) ?? { status: "not-reached", reason: input.outcome };
  }
  return {
    type: "desktop-startup",
    version: STARTUP_RECORD_VERSION,
    ...input.context,
    clock: input.clock.origin,
    outcome: input.outcome,
    writtenAtMs: input.clock.nowMs(),
    phases,
  };
}

/**
 * Folds one entry forwarded by the main window's preload into the clock: Chromium's paint
 * entries, and the web client's `e6:startup:` marks. A landing other than the app shell
 * means this launch never shows the shell, so `shellInteractive` cannot happen. The
 * `starting` landing is provisional: the panel gives way to the shell or the wizard once the
 * backend is ready, and the record carries that later landing instead. `starting` stays only
 * when nothing else lands.
 */
export function applyRendererStartupMark(
  clock: StartupClock,
  mark: { readonly name: string; readonly epochMs: number },
): void {
  const atMs = clock.fromEpochMs(mark.epochMs);
  if (mark.name === "first-paint") return clock.reach("rendererFirstPaint", {}, atMs);
  if (mark.name === "first-contentful-paint") {
    return clock.reach("rendererFirstContentfulPaint", {}, atMs);
  }
  const parsed = parseStartupMark(mark.name);
  if (parsed?.kind === "landing") {
    const current = clock.get("rendererLanding");
    if (
      current?.status === "reached" &&
      current.landing === "starting" &&
      parsed.landing !== "starting"
    ) {
      clock.revise("rendererLanding", { status: "reached", atMs, landing: parsed.landing });
    } else {
      clock.reach("rendererLanding", { landing: parsed.landing }, atMs);
    }
    if (parsed.landing !== "app" && parsed.landing !== "starting") {
      clock.notApplicable("shellInteractive", `landing:${parsed.landing}`);
    }
  } else if (parsed?.kind === "shell-interactive") {
    clock.reach(
      "shellInteractive",
      {
        syncStatus: parsed.syncStatus,
        ...(parsed.source === undefined ? {} : { source: parsed.source }),
      },
      atMs,
    );
  } else if (parsed?.kind === "shell-live") {
    clock.reach("shellLive", {}, atMs);
  }
}

export interface StartupMemoryBucket {
  readonly count: number;
  readonly workingSetBytes: number;
  readonly peakWorkingSetBytes: number;
  readonly pids: ReadonlyArray<number>;
}

export type StartupServerChildMemory =
  | { readonly status: "sampled"; readonly pid: number; readonly workingSetBytes: number }
  | {
      readonly status: "unavailable";
      readonly reason: "no-local-backend" | "wsl" | "not-running" | "probe-failed";
    };

export interface StartupElectronMemory {
  readonly main: StartupMemoryBucket;
  /** The main window's renderer. */
  readonly rendererMain: StartupMemoryBucket;
  /** Every other renderer: preview tabs, picture-in-picture, the connecting splash. */
  readonly rendererOther: StartupMemoryBucket;
  readonly gpu: StartupMemoryBucket;
  readonly utility: StartupMemoryBucket;
  readonly other: StartupMemoryBucket;
}

export interface StartupMemoryProcesses extends StartupElectronMemory {
  readonly serverChild: StartupServerChildMemory;
}

export interface StartupMemoryRecord {
  readonly type: "desktop-startup-memory";
  readonly version: typeof STARTUP_RECORD_VERSION;
  readonly runId: string;
  readonly pid: number;
  readonly label: string;
  readonly atMs: number;
  readonly processes: StartupMemoryProcesses;
}

/** The parts of Electron's `ProcessMetric` the memory sample reads. */
export interface AppProcessMetric {
  readonly pid: number;
  readonly type: string;
  /** Kilobytes, as Electron reports them. */
  readonly memory: { readonly workingSetSize: number; readonly peakWorkingSetSize: number };
}

const EMPTY_BUCKET: StartupMemoryBucket = {
  count: 0,
  workingSetBytes: 0,
  peakWorkingSetBytes: 0,
  pids: [],
};

const addToBucket = (bucket: StartupMemoryBucket, metric: AppProcessMetric) => ({
  count: bucket.count + 1,
  workingSetBytes: bucket.workingSetBytes + Math.round(metric.memory.workingSetSize * 1024),
  peakWorkingSetBytes:
    bucket.peakWorkingSetBytes + Math.round(metric.memory.peakWorkingSetSize * 1024),
  pids: [...bucket.pids, metric.pid],
});

/** Groups `app.getAppMetrics()` by process type; the server child is a Node spawn, not listed. */
export function classifyAppMetrics(
  metrics: ReadonlyArray<AppProcessMetric>,
  mainRendererPid: number | null,
): StartupElectronMemory {
  const buckets: Record<keyof StartupElectronMemory, StartupMemoryBucket> = {
    main: EMPTY_BUCKET,
    rendererMain: EMPTY_BUCKET,
    rendererOther: EMPTY_BUCKET,
    gpu: EMPTY_BUCKET,
    utility: EMPTY_BUCKET,
    other: EMPTY_BUCKET,
  };
  for (const metric of metrics) {
    const key: keyof StartupElectronMemory =
      metric.type === "Browser"
        ? "main"
        : metric.type === "Tab"
          ? metric.pid === mainRendererPid
            ? "rendererMain"
            : "rendererOther"
          : metric.type === "GPU"
            ? "gpu"
            : metric.type === "Utility"
              ? "utility"
              : "other";
    buckets[key] = addToBucket(buckets[key], metric);
  }
  return buckets;
}

/**
 * Reads a process's working set in kilobytes from `ps -o rss= -p <pid>` (macOS, Linux) or
 * `tasklist /FI "PID eq <pid>" /FO CSV /NH` (Windows, whose last column is a localised
 * figure such as `"123,456 K"`). Returns `null` when the output names no process.
 */
export function parseProcessWorkingSetKiB(platform: string, stdout: string): number | null {
  const text = stdout.trim();
  if (platform === "win32") {
    const lastField = /"([^"]*)"\s*$/.exec(text.split(/\r?\n/)[0] ?? "")?.[1];
    const digits = lastField?.replace(/\D/g, "") ?? "";
    return digits.length > 0 ? Number(digits) : null;
  }
  return /^\d+$/.test(text) ? Number(text) : null;
}
