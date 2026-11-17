import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * The steps of desktop bootstrap, after Electron is ready. `DesktopApp` supplies the real ones;
 * tests supply recorders. Every step that can fail with `E` is fatal to startup.
 */
export interface DesktopStartupSteps<E, R> {
  /** Completes when the login-shell import that `startup` began has finished. */
  readonly awaitShellEnvironment: Effect.Effect<void, never, R>;
  /**
   * Work that needs the imported environment and that nothing on the window's path waits for:
   * the Linux password store, the Linux URL handler and SnapShot. Runs in the background.
   */
  readonly afterShellEnvironment: Effect.Effect<void, never, R>;
  readonly registerProtocol: Effect.Effect<void, E, R>;
  readonly installIpcHandlers: Effect.Effect<void, E, R>;
  readonly localEnvironmentEnabled: Effect.Effect<boolean, never, R>;
  readonly markLocalEnvironmentDisabled: Effect.Effect<void, never, R>;
  readonly isQuitting: Effect.Effect<boolean, never, R>;
  /**
   * The app-activation control socket. `duplicate` when another instance owns it, in which case
   * the step has already asked the app to quit. On macOS this is the only duplicate check, so it
   * runs before any window exists.
   */
  readonly startAppActivation: Effect.Effect<"started" | "duplicate", never, R>;
  /**
   * Port, exposure, and everything the renderer needs before the backend spawns: the primary's
   * endpoint and token, its persisted environment id and the starting status.
   */
  readonly prepareLocalEnvironment: Effect.Effect<void, E, R>;
  /** WSL-only keeps the main window behind backend readiness, with a splash meanwhile. */
  readonly mainWaitsForBackend: Effect.Effect<boolean, never, R>;
  readonly showConnectingSplash: Effect.Effect<void, never, R>;
  readonly createMainWindow: Effect.Effect<void, E, R>;
  readonly markBackendStartRequested: Effect.Effect<void, never, R>;
  /** Starts the primary backend, then brings up any WSL backend the user enabled. */
  readonly startBackend: Effect.Effect<void, never, R>;
  /** The backend was never started because the app began quitting first. */
  readonly backendNotStarted: Effect.Effect<void, never, R>;
  /** The window is already open, so a failed start is reported, not fatal. */
  readonly backendStartFailed: (cause: Cause.Cause<unknown>) => Effect.Effect<void, never, R>;
}

/**
 * Bootstrap order. The window never waits for the login-shell import or the backend; the
 * backend spawn waits for the import only, in its own fiber, and never for the window.
 */
export const runDesktopStartupSequence = Effect.fn("desktop.startupSequence")(function* <E, R>(
  steps: DesktopStartupSteps<E, R>,
): Effect.fn.Return<void, E, R | Scope.Scope> {
  yield* steps.registerProtocol;
  yield* steps.installIpcHandlers;

  if (!(yield* steps.localEnvironmentEnabled)) {
    // No backend and no control socket: the renderer only talks to remote environments.
    yield* steps.markLocalEnvironmentDisabled;
    yield* Effect.forkScoped(steps.afterShellEnvironment);
    if (!(yield* steps.isQuitting)) {
      yield* steps.createMainWindow;
    }
    return;
  }

  if (yield* steps.isQuitting) return;
  if ((yield* steps.startAppActivation) === "duplicate") {
    return yield* Effect.interrupt;
  }
  yield* Effect.forkScoped(steps.afterShellEnvironment);
  yield* steps.prepareLocalEnvironment;

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      yield* steps.awaitShellEnvironment;
      // A quit that arrived while the import ran must not spawn a backend on its way out.
      if (yield* steps.isQuitting) {
        yield* steps.backendNotStarted;
        return;
      }
      yield* steps.markBackendStartRequested;
      yield* steps.startBackend;
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : steps.backendStartFailed(cause),
      ),
    ),
  );

  if (yield* steps.mainWaitsForBackend) {
    yield* steps.showConnectingSplash;
  } else {
    yield* steps.createMainWindow;
  }
});
