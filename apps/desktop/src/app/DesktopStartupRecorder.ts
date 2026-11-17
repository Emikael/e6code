import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopObservability from "./DesktopObservability.ts";
import { startupClock, type StartupClock } from "./DesktopStartupClock.ts";
import {
  buildStartupRecord,
  classifyAppMetrics,
  isStartupSettled,
  parseProcessWorkingSetKiB,
  STARTUP_MEMORY_SAMPLE_TIMES_MS,
  STARTUP_RECORD_DEADLINE_MS,
  STARTUP_RECORD_FILE_NAME,
  STARTUP_RECORD_VERSION,
  type StartupMemoryProcesses,
  type StartupMemoryRecord,
  type StartupRecordContext,
  type StartupRecordOutcome,
  type StartupServerChildMemory,
} from "./DesktopStartupRecord.ts";

const STARTUP_RECORD_FILE_MAX_BYTES = 1024 * 1024;
const STARTUP_RECORD_FILE_MAX_FILES = 2;

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("desktop-startup-record");

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export interface StartupRecorderOptions {
  readonly clock: StartupClock;
  readonly runId: string;
  readonly pid: number;
  readonly describe: Effect.Effect<Pick<StartupRecordContext, "app" | "launch">>;
  readonly sampleMemory: Effect.Effect<StartupMemoryProcesses>;
  /** Appends one NDJSON line; `line` has no trailing newline. */
  readonly writeLine: (line: string) => Effect.Effect<void>;
  readonly deadlineMs?: number;
  readonly memorySampleTimesMs?: ReadonlyArray<number>;
}

export interface StartupRecorder {
  /** Writes the record now with outcome `shutdown`, unless it was already written. */
  readonly flush: Effect.Effect<void>;
}

/**
 * Writes this launch's startup record once: when every required phase has resolved, or at
 * the deadline, whichever comes first, or from `flush` if the app quits before either.
 * Memory lines follow at fixed times after process start. The background work runs in the
 * caller's scope.
 */
export const makeStartupRecorder = Effect.fn("desktop.startupRecorder.make")(function* (
  options: StartupRecorderOptions,
): Effect.fn.Return<StartupRecorder, never, Scope.Scope> {
  const { clock } = options;
  const written = yield* Ref.make(false);
  const writeJsonLine = (value: unknown) =>
    encodeLine(value).pipe(
      Effect.flatMap(options.writeLine),
      Effect.catch((error) =>
        logWarning("desktop startup line not written", { error: error.message }),
      ),
    );

  const writeRecord = (outcome: StartupRecordOutcome) =>
    Effect.gen(function* () {
      if (yield* Ref.getAndSet(written, true)) return;
      const described = yield* options.describe;
      const record = buildStartupRecord({
        context: { runId: options.runId, pid: options.pid, ...described },
        clock,
        outcome,
      });
      yield* writeJsonLine(record);
      yield* logInfo("desktop startup record written", { outcome });
    });

  const sleepUntil = (atMs: number) =>
    Effect.suspend(() => Effect.sleep(Duration.millis(Math.max(0, atMs - clock.nowMs()))));

  const settled = Effect.callback<void>((resume) => {
    const check = () => {
      if (isStartupSettled(clock)) resume(Effect.void);
    };
    const unsubscribe = clock.subscribe(check);
    check();
    return Effect.sync(unsubscribe);
  });

  yield* Effect.raceFirst(
    settled.pipe(Effect.as<StartupRecordOutcome>("settled")),
    sleepUntil(options.deadlineMs ?? STARTUP_RECORD_DEADLINE_MS).pipe(
      Effect.as<StartupRecordOutcome>("deadline"),
    ),
  ).pipe(Effect.flatMap(writeRecord), Effect.forkScoped);

  for (const sampleAtMs of options.memorySampleTimesMs ?? STARTUP_MEMORY_SAMPLE_TIMES_MS) {
    const label = `${Math.round(sampleAtMs / 1000)}s`;
    yield* sleepUntil(sampleAtMs).pipe(
      Effect.andThen(options.sampleMemory),
      Effect.flatMap((processes) =>
        writeJsonLine({
          type: "desktop-startup-memory",
          version: STARTUP_RECORD_VERSION,
          runId: options.runId,
          pid: options.pid,
          label,
          atMs: clock.nowMs(),
          processes,
        } satisfies StartupMemoryRecord),
      ),
      Effect.andThen(logInfo("desktop startup memory sampled", { label })),
      Effect.forkScoped,
    );
  }

  return { flush: writeRecord("shutdown") };
});

const readProcessWorkingSetBytes = Effect.fn("desktop.startupRecorder.readProcessWorkingSet")(
  function* (platform: NodeJS.Platform, pid: number) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command =
      platform === "win32"
        ? ChildProcess.make("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"])
        : ChildProcess.make("ps", ["-o", "rss=", "-p", String(pid)]);
    const stdout = yield* spawner.string(command);
    const kib = parseProcessWorkingSetKiB(platform, stdout);
    return kib === null ? Option.none<number>() : Option.some(kib * 1024);
  },
);

/** Starts the recorder for this launch, writing to `<logDir>/desktop-startup.ndjson`. */
export const startDesktopStartupRecorder = Effect.fn("desktop.startupRecorder.start")(function* (
  runId: string,
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const pool = yield* DesktopBackendPool.DesktopBackendPool;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const filePath = environment.path.join(environment.logDir, STARTUP_RECORD_FILE_NAME);
  const writer = yield* DesktopObservability.makeRotatingLogFileWriter({
    filePath,
    maxBytes: STARTUP_RECORD_FILE_MAX_BYTES,
    maxFiles: STARTUP_RECORD_FILE_MAX_FILES,
  }).pipe(
    Effect.tapError((error) =>
      logWarning("desktop startup record unavailable", { filePath, error: error.message }),
    ),
    Effect.option,
  );
  if (Option.isNone(writer)) return { flush: Effect.void } satisfies StartupRecorder;

  const describe = desktopSettings.get.pipe(
    Effect.map((settings) => ({
      app: {
        version: environment.appVersion,
        platform: environment.platform,
        arch: environment.processArch,
        isPackaged: environment.isPackaged,
        isDevelopment: environment.isDevelopment,
      },
      launch: {
        localEnvironmentEnabled: settings.localEnvironmentEnabled,
        wslOnly: settings.wslOnly,
        wslBackendEnabled: settings.wslBackendEnabled,
      },
    })),
  );

  // Read when sampling rather than when the backend spawns, so a restart before the sample
  // still measures the live child.
  const sampleServerChild: Effect.Effect<StartupServerChildMemory> = Effect.gen(function* () {
    if (!(yield* desktopSettings.get).localEnvironmentEnabled) {
      return { status: "unavailable", reason: "no-local-backend" } as const;
    }
    const primary = yield* pool.primary;
    const config = yield* primary.currentConfig;
    if (Option.isSome(config) && config.value.runningDistro !== undefined) {
      return { status: "unavailable", reason: "wsl" } as const;
    }
    const pid = (yield* primary.snapshot).activePid;
    if (Option.isNone(pid)) return { status: "unavailable", reason: "not-running" } as const;
    const workingSetBytes = yield* readProcessWorkingSetBytes(environment.platform, pid.value).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.orElseSucceed(() => Option.none<number>()),
    );
    return Option.match(workingSetBytes, {
      onNone: () => ({ status: "unavailable", reason: "probe-failed" }) as const,
      onSome: (bytes) => ({ status: "sampled", pid: pid.value, workingSetBytes: bytes }) as const,
    });
  });

  const sampleMemory = Effect.gen(function* () {
    const metrics = yield* electronApp.getAppMetrics;
    const mainWindow = yield* electronWindow.main;
    const mainRendererPid = Option.match(mainWindow, {
      onNone: () => null,
      onSome: (window) => (window.isDestroyed() ? null : window.webContents.getOSProcessId()),
    });
    return {
      ...classifyAppMetrics(metrics, mainRendererPid),
      serverChild: yield* sampleServerChild,
    } satisfies StartupMemoryProcesses;
  });

  return yield* makeStartupRecorder({
    clock: startupClock,
    runId,
    pid: process.pid,
    describe,
    sampleMemory,
    writeLine: (line) => writer.value.writeText(`${line}\n`),
  });
});
