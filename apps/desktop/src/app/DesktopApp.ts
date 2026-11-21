import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { EnvironmentId } from "@e6tools/contracts";
import * as NetService from "@e6tools/shared/Net";
import * as Crypto from "effect/Crypto";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import { installDesktopIpcHandlers } from "../ipc/DesktopIpcHandlers.ts";
import * as DesktopAppActivation from "./DesktopAppActivation.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopClerk from "./DesktopClerk.ts";
import * as DesktopApplicationMenu from "../window/DesktopApplicationMenu.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as DesktopLocalBackendStatus from "../backend/DesktopLocalBackendStatus.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLifecycle from "./DesktopLifecycle.ts";
import * as DesktopLinuxUrlHandler from "./DesktopLinuxUrlHandler.ts";
import * as DesktopObservability from "./DesktopObservability.ts";
import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import { startupClock } from "./DesktopStartupClock.ts";
import { startDesktopStartupRecorder } from "./DesktopStartupRecorder.ts";
import { runDesktopStartupSequence } from "./DesktopStartupSequence.ts";
import { resolveLocalEnvironmentIdPath } from "./DesktopStatePaths.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopShellEnvironment from "../shell/DesktopShellEnvironment.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopRemoteUpdates from "../updates/DesktopRemoteUpdates.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopSnapShot from "../snapShot/DesktopSnapShot.ts";
import * as DesktopWslBackend from "../wsl/DesktopWslBackend.ts";

const DEFAULT_DESKTOP_BACKEND_PORT = 3773;
const MAX_TCP_PORT = 65_535;
const DESKTOP_BACKEND_PORT_PROBE_HOSTS = ["127.0.0.1", "0.0.0.0", "::"] as const;

const makeDesktopRunId = Crypto.Crypto.pipe(
  Effect.flatMap((crypto) => crypto.randomUUIDv4),
  Effect.map((value) => value.replaceAll("-", "").slice(0, 12)),
);

export class DesktopBackendPortUnavailableError extends Schema.TaggedError<DesktopBackendPortUnavailableError>()(
  "DesktopBackendPortUnavailableError",
  {
    startPort: Schema.Int,
    maxPort: Schema.Int,
    hosts: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `No desktop backend port is available on hosts ${this.hosts.join(", ")} between ${this.startPort} and ${this.maxPort}.`;
  }
}

export class DesktopDevelopmentBackendPortRequiredError extends Schema.TaggedError<DesktopDevelopmentBackendPortRequiredError>()(
  "DesktopDevelopmentBackendPortRequiredError",
  {},
) {
  override get message(): string {
    return "E6CODE_PORT is required in desktop development.";
  }
}

const { logInfo: logBootstrapInfo, logWarning: logBootstrapWarning } =
  DesktopObservability.makeComponentLogger("desktop-bootstrap");

const { logInfo: logStartupInfo, logError: logStartupError } =
  DesktopObservability.makeComponentLogger("desktop-startup");

const resolveDesktopBackendPort = Effect.fn("resolveDesktopBackendPort")(function* (
  configuredPort: Option.Option<number>,
) {
  if (Option.isSome(configuredPort)) {
    return {
      port: configuredPort.value,
      selectedByScan: false,
    } as const;
  }

  const net = yield* NetService.NetService;
  for (let port = DEFAULT_DESKTOP_BACKEND_PORT; port <= MAX_TCP_PORT; port += 1) {
    let availableOnEveryHost = true;

    for (const host of DESKTOP_BACKEND_PORT_PROBE_HOSTS) {
      if (!(yield* net.canListenOnHost(port, host))) {
        availableOnEveryHost = false;
        break;
      }
    }

    if (availableOnEveryHost) {
      return {
        port,
        selectedByScan: true,
      } as const;
    }
  }

  return yield* new DesktopBackendPortUnavailableError({
    startPort: DEFAULT_DESKTOP_BACKEND_PORT,
    maxPort: MAX_TCP_PORT,
    hosts: DESKTOP_BACKEND_PORT_PROBE_HOSTS,
  });
});

const handleFatalStartupError = Effect.fn("desktop.startup.handleFatalStartupError")(function* (
  stage: string,
  error: unknown,
): Effect.fn.Return<
  void,
  never,
  | DesktopShutdown.DesktopShutdown
  | DesktopState.DesktopState
  | ElectronApp.ElectronApp
  | ElectronDialog.ElectronDialog
> {
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const state = yield* DesktopState.DesktopState;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const message = error instanceof Error ? error.message : String(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  yield* logStartupError("fatal startup error", {
    stage,
    message,
    ...(detail.length > 0 ? { detail } : {}),
  });
  const wasQuitting = yield* Ref.getAndSet(state.quitting, true);
  if (!wasQuitting) {
    yield* electronDialog.showErrorBox(
      "E6 Code failed to start",
      `Stage: ${stage}\n${message}${detail}`,
    );
  }
  yield* shutdown.request;
  yield* electronApp.quit;
});

const fatalStartupCause = <E>(stage: string, cause: Cause.Cause<E>) =>
  handleFatalStartupError(stage, Cause.pretty(cause)).pipe(Effect.andThen(Effect.failCause(cause)));

export const stopAllPoolInstances = Effect.fn("desktop.app.stopAllPoolInstances")(
  function* (): Effect.fn.Return<void, never, DesktopBackendPool.DesktopBackendPool> {
    // Stop every backend in the pool with a timeout to guarantee the quit
    // path makes progress even if a backend hangs during teardown.
    const pool = yield* DesktopBackendPool.DesktopBackendPool;
    const instances = yield* pool.list;
    yield* Effect.forEach(
      instances,
      (instance) => instance.stop({ timeout: Duration.seconds(5) }),
      { concurrency: "unbounded" },
    );
  },
);

const readPrimaryEnvironmentId = Effect.fn("desktop.bootstrap.readPrimaryEnvironmentId")(
  function* (): Effect.fn.Return<
    EnvironmentId | null,
    never,
    DesktopEnvironment.DesktopEnvironment | FileSystem.FileSystem
  > {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem
      .readFileString(resolveLocalEnvironmentIdPath(environment.stateDir, environment.path.join))
      .pipe(Effect.option);
    return Option.getOrNull(Option.flatMap(raw, decodeEnvironmentId));
  },
);

const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);

// Linux reads its secret-store backend from the desktop session, which the login-shell import
// can correct, so this follows the import, as it always has.
const configureLinuxPasswordStore = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const preReadyElectronOptions = yield* DesktopPreReadyPlatform.DesktopPreReadyElectronOptions;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const hasCommandLinePasswordStore =
    preReadyElectronOptions.linuxPasswordStoreCommandLine !== null;
  const linuxElectronOptions =
    environment.platform === "linux" && !hasCommandLinePasswordStore
      ? DesktopPreReadyPlatform.resolveEarlyLinuxElectronOptionsFromProcess()
      : preReadyElectronOptions.linux;
  if (linuxElectronOptions !== null && !hasCommandLinePasswordStore) {
    if (
      linuxElectronOptions.passwordStore !== null ||
      preReadyElectronOptions.linux?.passwordStore !== null
    ) {
      yield* electronApp.removeCommandLineSwitch("password-store");
    }
    if (linuxElectronOptions.passwordStore !== null) {
      yield* electronApp.appendCommandLineSwitch(
        "password-store",
        linuxElectronOptions.passwordStore,
      );
    }
  }
  if (linuxElectronOptions !== null) {
    yield* logStartupInfo("linux password store configured", {
      passwordStore: hasCommandLinePasswordStore
        ? "command-line"
        : (linuxElectronOptions.passwordStore ?? "electron-default"),
      xdgCurrentDesktop: process.env.XDG_CURRENT_DESKTOP ?? null,
      xdgSessionDesktop: process.env.XDG_SESSION_DESKTOP ?? null,
    });
  }
  if (environment.platform === "linux") {
    const selectedBackend = yield* safeStorage.selectedStorageBackend;
    yield* logStartupInfo("safe storage ready", {
      backend: Option.getOrElse(selectedBackend, () => "unknown"),
    });
  }
});

const configureBackendEndpoint = Effect.fn("desktop.bootstrap.configureBackendEndpoint")(function* (
  settings: DesktopAppSettings.DesktopSettings,
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;

  if (environment.isDevelopment && Option.isNone(environment.configuredBackendPort)) {
    return yield* new DesktopDevelopmentBackendPortRequiredError();
  }

  const backendPortSelection = yield* resolveDesktopBackendPort(environment.configuredBackendPort);
  const backendPort = backendPortSelection.port;
  yield* logBootstrapInfo(
    backendPortSelection.selectedByScan
      ? "selected backend port via sequential scan"
      : "using configured backend port",
    {
      port: backendPort,
      ...(backendPortSelection.selectedByScan ? { startPort: DEFAULT_DESKTOP_BACKEND_PORT } : {}),
    },
  );

  if (settings.serverExposureMode !== environment.defaultDesktopSettings.serverExposureMode) {
    yield* logBootstrapInfo("bootstrap restoring persisted server exposure mode", {
      mode: settings.serverExposureMode,
    });
  }
  const serverExposureState = yield* serverExposure.configureFromSettings({ port: backendPort });
  const backendConfig = yield* serverExposure.backendConfig;
  yield* logBootstrapInfo("bootstrap resolved backend endpoint", {
    baseUrl: backendConfig.httpBaseUrl.href,
  });
  if (serverExposureState.endpointUrl) {
    yield* logBootstrapInfo("bootstrap enabled network access", {
      endpointUrl: serverExposureState.endpointUrl,
    });
  } else if (
    settings.serverExposureMode === "network-accessible" &&
    serverExposureState.mode === "local-only"
  ) {
    yield* logBootstrapWarning(
      "bootstrap fell back to local-only because no advertised network host was available",
    );
  }
});

type BootstrapError =
  | ElectronProtocol.ElectronProtocolRegistrationError
  | Effect.Error<ReturnType<typeof installDesktopIpcHandlers>>
  | DesktopBackendPortUnavailableError
  | DesktopDevelopmentBackendPortRequiredError
  | DesktopWindow.DesktopWindowError;

type BootstrapServices =
  | Effect.Services<ReturnType<typeof installDesktopIpcHandlers>>
  | Effect.Services<ReturnType<typeof configureBackendEndpoint>>
  | Effect.Services<ReturnType<typeof readPrimaryEnvironmentId>>
  | ElectronProtocol.ElectronProtocol
  | DesktopWslBackend.DesktopWslBackend
  | DesktopPreReadyPlatform.DesktopPreReadyElectronOptions
  | ElectronSafeStorage.ElectronSafeStorage
  | Scope.Scope;

const bootstrap = Effect.gen(function* () {
  const state = yield* DesktopState.DesktopState;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const snapShot = yield* DesktopSnapShot.DesktopSnapShot;
  const appActivation = yield* DesktopAppActivation.DesktopAppActivation;
  const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
  const linuxUrlHandler = yield* DesktopLinuxUrlHandler.DesktopLinuxUrlHandler;
  const localStatus = yield* DesktopLocalBackendStatus.DesktopLocalBackendStatus;
  yield* logBootstrapInfo("bootstrap start");

  const settings = yield* desktopSettings.get;
  const mainWaitsForBackend = settings.wslOnly === true && settings.wslBackendEnabled === true;

  yield* runDesktopStartupSequence<BootstrapError, BootstrapServices>({
    awaitShellEnvironment: shellEnvironment.awaitInstalled,
    afterShellEnvironment: Effect.gen(function* () {
      yield* shellEnvironment.awaitInstalled;
      yield* configureLinuxPasswordStore;
      yield* linuxUrlHandler.register;
      yield* snapShot.initialize;
    }).pipe(Effect.withSpan("desktop.startup.afterShellEnvironment")),
    // The renderer is served from the bundled client (or Vite in development)
    // rather than through the local backend, so the window can open without one.
    registerProtocol: Effect.gen(function* () {
      const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
      yield* electronProtocol.registerDesktopProtocol({
        scheme: ElectronProtocol.getDesktopScheme(environment.isDevelopment),
        ...(environment.isDevelopment
          ? { targetOrigin: Option.getOrThrow(environment.devServerUrl) }
          : { assetDirectory: environment.clientAssetsDir }),
        clerkFrontendApiHostname: DesktopClerk.desktopClerkFrontendApiHostname,
      });
      startupClock.reach("protocolRegistered");
    }),
    installIpcHandlers: installDesktopIpcHandlers().pipe(
      Effect.tap(() => logBootstrapInfo("bootstrap ipc handlers registered")),
    ),
    localEnvironmentEnabled: Effect.succeed(settings.localEnvironmentEnabled),
    markLocalEnvironmentDisabled: Effect.gen(function* () {
      startupClock.notApplicable("backendReady", "local-environment-disabled");
      yield* logBootstrapInfo("bootstrap skipping local environment (disabled in settings)");
    }),
    isQuitting: Ref.get(state.quitting),
    startAppActivation: appActivation.start.pipe(
      Effect.tap(() => logBootstrapInfo("desktop app control socket ready")),
      Effect.as("started" as const),
      // A live owner means a sibling instance won the startup race. Quit
      // instead of booting a duplicate backend and window; anything else
      // keeps the previous degraded-but-running behavior.
      Effect.catchTag("DesktopAppActivationDuplicateInstanceError", (error) =>
        Effect.gen(function* () {
          yield* logBootstrapInfo("another desktop instance is already running; quitting", {
            address: error.address,
          });
          yield* electronApp.quit;
          return "duplicate" as const;
        }),
      ),
      Effect.catchTag("DesktopAppActivationStartError", (error) =>
        logStartupError("desktop app control socket unavailable", { error }).pipe(
          Effect.as("started" as const),
        ),
      ),
    ),
    prepareLocalEnvironment: Effect.gen(function* () {
      const pool = yield* DesktopBackendPool.DesktopBackendPool;
      const primaryBackend = yield* pool.primary;
      yield* configureBackendEndpoint(settings);
      // WSL-only resolves its config through a WSL preflight that spawns wsl.exe, so it is not
      // prepared ahead of the spawn and has no cached identity: it keeps today's splash flow.
      if (!mainWaitsForBackend) {
        yield* primaryBackend.prepare;
      }
      const environmentId = mainWaitsForBackend ? null : yield* readPrimaryEnvironmentId();
      yield* localStatus.begin({ environmentId, label: yield* primaryBackend.label });
    }),
    mainWaitsForBackend: Effect.succeed(mainWaitsForBackend),
    showConnectingSplash: desktopWindow.showConnectingSplash,
    createMainWindow: desktopWindow.openMainAtStartup.pipe(Effect.asVoid),
    markBackendStartRequested: Effect.sync(() => startupClock.reach("backendStartRequested")),
    startBackend: Effect.gen(function* () {
      const pool = yield* DesktopBackendPool.DesktopBackendPool;
      const wslBackend = yield* DesktopWslBackend.DesktopWslBackend;
      yield* (yield* pool.primary).start;
      yield* logBootstrapInfo("bootstrap backend start requested");
      // Bring up the WSL backend if the user previously enabled it. The
      // primary is already starting; reconcile fires off the WSL register
      // in parallel rather than blocking primary readiness on a possibly
      // slow first wsl.exe spawn.
      yield* Effect.forkScoped(wslBackend.reconcile);
    }),
    backendNotStarted: localStatus.markStopped.pipe(
      Effect.andThen(logBootstrapInfo("quitting before the backend started; not starting it")),
    ),
    backendStartFailed: (cause) =>
      logStartupError("local backend failed to start", { cause: Cause.pretty(cause) }).pipe(
        Effect.andThen(localStatus.markFailed(Cause.pretty(cause))),
      ),
  });
}).pipe(Effect.withSpan("desktop.bootstrap"));

const startup = Effect.gen(function* () {
  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const applicationMenu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
  const electronApp = yield* ElectronApp.ElectronApp;
  const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
  const clerk = yield* DesktopClerk.DesktopClerk;
  const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;

  // The import runs while everything below happens; only work that spawns processes needing
  // the user's PATH, SSH agent or desktop session waits for it (see DesktopStartupSequence).
  yield* shellEnvironment.start;
  const userDataPath = yield* appIdentity.resolveUserDataPath;
  yield* electronApp.setPath("userData", userDataPath);
  yield* logStartupInfo("runtime logging configured", { logDir: environment.logDir });
  const settingsLoadStartMs = startupClock.nowMs();
  yield* desktopSettings.load;
  startupClock.reach("settingsLoad", { startMs: settingsLoadStartMs });

  yield* lifecycle.register;
  yield* clerk.configure;

  yield* electronApp.whenReady.pipe(
    Effect.withSpan("desktop.electron.whenReady"),
    Effect.catchCause((cause) => fatalStartupCause("whenReady", cause)),
  );
  yield* logStartupInfo("app ready");
  yield* appIdentity.configure;
  yield* applicationMenu.configure;
  yield* updates.configure;
  yield* DesktopRemoteUpdates.listen;
  yield* bootstrap.pipe(Effect.catchCause((cause) => fatalStartupCause("bootstrap", cause)));
}).pipe(Effect.withSpan("desktop.startup"));

const scopedProgram = Effect.scoped(
  Effect.gen(function* () {
    const runId = yield* makeDesktopRunId;
    yield* Effect.annotateLogsScoped({ scope: "desktop", runId });
    yield* Effect.annotateCurrentSpan({ scope: "desktop", runId });

    const shutdown = yield* DesktopShutdown.DesktopShutdown;

    yield* Effect.addFinalizer(() =>
      // Stop every backend in the pool, not just the primary. The
      // electronApp.quit() path can race ahead of the layer-scope
      // cascade, so leaving the WSL instance for its parent scope
      // finalizer means it gets hard-killed by the OS instead of
      // receiving SIGTERM + grace.
      stopAllPoolInstances().pipe(Effect.ensuring(shutdown.markComplete)),
    );

    const startupRecorder = yield* startDesktopStartupRecorder(runId);
    // Added after the pool finalizer so it runs first: a launch that quits before its record
    // settles still writes one.
    yield* Effect.addFinalizer(() => startupRecorder.flush);

    yield* startup;
    yield* shutdown.awaitRequest;
  }),
);

export const program = scopedProgram.pipe(Effect.withSpan("desktop.app"));
