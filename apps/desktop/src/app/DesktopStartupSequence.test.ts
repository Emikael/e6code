import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { runDesktopStartupSequence, type DesktopStartupSteps } from "./DesktopStartupSequence.ts";

class WindowCreateFailed extends Schema.TaggedError<WindowCreateFailed>()(
  "WindowCreateFailed",
  {},
) {}

interface Harness {
  readonly steps: DesktopStartupSteps<WindowCreateFailed, never>;
  /** Completes the login-shell import the sequence's backend fiber waits on. */
  readonly finishImport: Effect.Effect<void>;
  readonly quitting: Ref.Ref<boolean>;
  readonly events: Ref.Ref<ReadonlyArray<string>>;
  readonly backendFailures: Ref.Ref<ReadonlyArray<string>>;
  /** Completes once the backend fiber has finished, whichever way it went. */
  readonly backendSettled: Deferred.Deferred<void>;
  readonly afterImportSettled: Deferred.Deferred<void>;
}

const makeHarness = (
  options: {
    readonly localEnvironmentEnabled?: boolean;
    readonly mainWaitsForBackend?: boolean;
    readonly duplicate?: boolean;
    readonly startBackend?: Effect.Effect<void>;
    readonly createMainWindow?: Effect.Effect<void, WindowCreateFailed>;
  } = {},
) =>
  Effect.gen(function* () {
    const imported = yield* Deferred.make<void>();
    const quitting = yield* Ref.make(false);
    const events = yield* Ref.make<ReadonlyArray<string>>([]);
    const backendFailures = yield* Ref.make<ReadonlyArray<string>>([]);
    const backendSettled = yield* Deferred.make<void>();
    const afterImportSettled = yield* Deferred.make<void>();
    const record = (event: string) => Ref.update(events, (current) => [...current, event]);
    const settleBackend = Deferred.succeed(backendSettled, undefined).pipe(Effect.asVoid);

    const steps: DesktopStartupSteps<WindowCreateFailed, never> = {
      awaitShellEnvironment: Deferred.await(imported),
      afterShellEnvironment: Deferred.await(imported).pipe(
        Effect.andThen(record("afterShellEnvironment")),
        Effect.andThen(Deferred.succeed(afterImportSettled, undefined)),
        Effect.asVoid,
      ),
      registerProtocol: record("protocol"),
      installIpcHandlers: record("ipc"),
      localEnvironmentEnabled: Effect.succeed(options.localEnvironmentEnabled ?? true),
      markLocalEnvironmentDisabled: record("localEnvironmentDisabled"),
      isQuitting: Ref.get(quitting),
      startAppActivation: record("controlSocket").pipe(
        Effect.as(options.duplicate === true ? ("duplicate" as const) : ("started" as const)),
      ),
      prepareLocalEnvironment: record("prepare"),
      mainWaitsForBackend: Effect.succeed(options.mainWaitsForBackend ?? false),
      showConnectingSplash: record("splash"),
      createMainWindow: record("window").pipe(
        Effect.andThen(options.createMainWindow ?? Effect.void),
      ),
      markBackendStartRequested: record("backendStartRequested"),
      // A failed start settles through backendStartFailed instead.
      startBackend: record("backendStart").pipe(
        Effect.andThen(options.startBackend ?? Effect.void),
        Effect.andThen(settleBackend),
      ),
      backendNotStarted: record("backendNotStarted").pipe(Effect.ensuring(settleBackend)),
      backendStartFailed: (cause) =>
        Ref.update(backendFailures, (current) => [...current, Cause.pretty(cause)]).pipe(
          Effect.ensuring(settleBackend),
        ),
    };

    return {
      steps,
      finishImport: Deferred.succeed(imported, undefined).pipe(Effect.asVoid),
      quitting,
      events,
      backendFailures,
      backendSettled,
      afterImportSettled,
    } satisfies Harness;
  });

describe("DesktopStartupSequence", () => {
  it.effect("opens the window while the import runs and starts the backend only after it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();

        yield* runDesktopStartupSequence(harness.steps);

        // The import is still pending, yet protocol, control socket and window are done.
        assert.deepEqual(yield* Ref.get(harness.events), [
          "protocol",
          "ipc",
          "controlSocket",
          "prepare",
          "window",
        ]);

        yield* harness.finishImport;
        yield* Deferred.await(harness.backendSettled);
        yield* Deferred.await(harness.afterImportSettled);

        const events = yield* Ref.get(harness.events);
        assert.deepEqual(events.slice(5).sort(), [
          "afterShellEnvironment",
          "backendStart",
          "backendStartRequested",
        ]);
        assert.isBelow(events.indexOf("backendStartRequested"), events.indexOf("backendStart"));
      }),
    ),
  );

  it.effect("starts the backend even when the import finishes before the window", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const windowCreated = yield* Deferred.make<void>();
        const harness = yield* makeHarness({
          // The backend fiber may run before the window: it never waits for it.
          createMainWindow: Deferred.await(windowCreated),
        });
        yield* harness.finishImport;

        const sequence = yield* Effect.forkChild(runDesktopStartupSequence(harness.steps));
        yield* Deferred.await(harness.backendSettled);
        assert.include(yield* Ref.get(harness.events), "backendStart");

        yield* Deferred.succeed(windowCreated, undefined);
        yield* Fiber.join(sequence);
      }),
    ),
  );

  it.effect("quits a duplicate instance before it opens a window or starts a backend", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({ duplicate: true });

        const exit = yield* Effect.exit(runDesktopStartupSequence(harness.steps));
        yield* harness.finishImport;
        yield* Effect.yieldNow;

        assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
        assert.deepEqual(yield* Ref.get(harness.events), ["protocol", "ipc", "controlSocket"]);
      }),
    ),
  );

  it.effect("never starts the backend once a quit arrives during the import", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();

        yield* runDesktopStartupSequence(harness.steps);
        yield* Ref.set(harness.quitting, true);
        yield* harness.finishImport;
        yield* Deferred.await(harness.backendSettled);

        const events = yield* Ref.get(harness.events);
        assert.include(events, "backendNotStarted");
        assert.notInclude(events, "backendStartRequested");
        assert.notInclude(events, "backendStart");
      }),
    ),
  );

  it.effect("reports a failed backend start without failing startup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          startBackend: Effect.die(new Error("spawn exploded\n    at stack frame")),
        });

        const exit = yield* Effect.exit(runDesktopStartupSequence(harness.steps));
        yield* harness.finishImport;
        yield* Deferred.await(harness.backendSettled);

        assert.isTrue(Exit.isSuccess(exit));
        assert.include(yield* Ref.get(harness.events), "window");
        const failures = yield* Ref.get(harness.backendFailures);
        assert.lengthOf(failures, 1);
        assert.include(failures[0], "spawn exploded");
      }),
    ),
  );

  it.effect("fails startup when the main window cannot be created", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          createMainWindow: Effect.fail(new WindowCreateFailed()),
        });

        const exit = yield* Effect.exit(runDesktopStartupSequence(harness.steps));

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.instanceOf(Cause.squash(exit.cause), WindowCreateFailed);
        }
      }),
    ),
  );

  it.effect("opens the window at once with no backend or control socket when disabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({ localEnvironmentEnabled: false });

        yield* runDesktopStartupSequence(harness.steps);
        yield* harness.finishImport;
        yield* Deferred.await(harness.afterImportSettled);

        assert.deepEqual(yield* Ref.get(harness.events), [
          "protocol",
          "ipc",
          "localEnvironmentDisabled",
          "window",
          "afterShellEnvironment",
        ]);
      }),
    ),
  );

  it.effect("keeps WSL-only behind the splash and still starts the backend after the import", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({ mainWaitsForBackend: true });

        yield* runDesktopStartupSequence(harness.steps);
        assert.deepEqual(yield* Ref.get(harness.events), [
          "protocol",
          "ipc",
          "controlSocket",
          "prepare",
          "splash",
        ]);

        yield* harness.finishImport;
        yield* Deferred.await(harness.backendSettled);
        const events = yield* Ref.get(harness.events);
        assert.include(events, "backendStart");
        assert.notInclude(events, "window");
      }),
    ),
  );
});
