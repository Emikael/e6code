import { EnvironmentId } from "@e6tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopLocalBackendStatus from "./DesktopLocalBackendStatus.ts";

const environmentId = EnvironmentId.make("env-local");

const withStatus = <A, E>(
  use: (
    status: DesktopLocalBackendStatus.DesktopLocalBackendStatus["Service"],
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const status = yield* DesktopLocalBackendStatus.DesktopLocalBackendStatus;
    return yield* use(status);
  }).pipe(Effect.provide(Layer.mergeAll(DesktopLocalBackendStatus.layer, TestClock.layer())));

describe("DesktopLocalBackendStatus", () => {
  it.effect("stays null until startup begins it", () =>
    withStatus((status) =>
      Effect.gen(function* () {
        yield* status.markReady;
        yield* status.markFailed("ignored");
        assert.isNull(yield* status.get);
      }),
    ),
  );

  it.effect("follows a start that restarts twice, then becomes ready", () =>
    withStatus((status) =>
      Effect.gen(function* () {
        yield* status.begin({ environmentId, label: "Local environment" });
        assert.deepInclude(yield* status.get, {
          state: "starting",
          environmentId,
          label: "Local environment",
          restartAttempt: 0,
          reason: null,
          sinceEpochMs: 0,
        });

        yield* TestClock.adjust(Duration.seconds(2));
        yield* status.markRestartScheduled({ reason: "code=1", attempt: 1 });
        yield* TestClock.adjust(Duration.seconds(1));
        yield* status.markRestartScheduled({ reason: "code=7", attempt: 2 });
        assert.deepInclude(yield* status.get, {
          state: "restarting",
          restartAttempt: 2,
          reason: "code=7",
          // The state began at the first restart, not the latest.
          sinceEpochMs: 2_000,
        });

        yield* TestClock.adjust(Duration.seconds(1));
        yield* status.markReady;
        assert.deepInclude(yield* status.get, {
          state: "ready",
          restartAttempt: 0,
          reason: null,
          sinceEpochMs: 4_000,
        });
      }),
    ),
  );

  it.effect("reads an exit after ready as restarting until the restart reports why", () =>
    withStatus((status) =>
      Effect.gen(function* () {
        yield* status.begin({ environmentId, label: "Local environment" });
        yield* status.markReady;
        yield* status.markNotReady;
        assert.deepInclude(yield* status.get, {
          state: "restarting",
          restartAttempt: 0,
          reason: null,
        });
        yield* status.markRestartScheduled({ reason: "pid=123 code=1", attempt: 1 });
        assert.deepInclude(yield* status.get, {
          state: "restarting",
          restartAttempt: 1,
          reason: "pid=123 code=1",
        });
      }),
    ),
  );

  it.effect("keeps a failure to one line without its stack", () =>
    withStatus((status) =>
      Effect.gen(function* () {
        yield* status.begin({ environmentId: null, label: "WSL (Ubuntu)" });
        yield* status.markFailed(
          "\n  Error: spawn   exploded\n    at runBackendProcess (DesktopBackendManager.ts:493)\n",
        );
        assert.deepInclude(yield* status.get, {
          state: "failed",
          environmentId: null,
          label: "WSL (Ubuntu)",
          reason: "Error: spawn exploded",
        });
      }),
    ),
  );

  it.effect("separates a deliberate stop from a failure", () =>
    withStatus((status) =>
      Effect.gen(function* () {
        yield* status.begin({ environmentId, label: "Local environment" });
        yield* status.markRestartScheduled({ reason: "code=1", attempt: 1 });
        yield* status.markStopped;
        assert.deepInclude(yield* status.get, {
          state: "stopped",
          restartAttempt: 0,
          reason: null,
        });
      }),
    ),
  );
});
