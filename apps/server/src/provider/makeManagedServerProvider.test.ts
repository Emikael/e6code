import { describe, it, assert } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@e6tools/contracts";
import { createModelCapabilities } from "@e6tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeManagedServerProvider } from "./makeManagedServerProvider.ts";

const emptyCapabilities = createModelCapabilities({ optionDescriptors: [] });
const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");
const fastModeCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

interface TestSettings {
  readonly enabled: boolean;
  readonly updateChecks?: boolean;
}

const maintenanceCapabilities = {
  provider: ProviderDriverKind.make("codex"),
  packageName: "@openai/codex",
  update: {
    command: "npm install -g @openai/codex@latest",

    executable: "npm",

    args: ["install", "-g", "@openai/codex@latest"],

    lockKey: "npm-global",
  },
} as const;

const initialSnapshot: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "warning",
  auth: { status: "unknown" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  message: "Checking provider availability...",
  models: [],
  slashCommands: [],
  skills: [],
};

const refreshedSnapshot: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:01.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

const enrichedSnapshot: ServerProvider = {
  ...refreshedSnapshot,
  checkedAt: "2026-04-10T00:00:02.000Z",
  models: [
    {
      slug: "composer-2",
      name: "Composer 2",
      isCustom: false,
      capabilities: fastModeCapabilities,
    },
  ],
};

const refreshedSnapshotSecond: ServerProvider = {
  ...refreshedSnapshot,
  checkedAt: "2026-04-10T00:00:03.000Z",
  message: "Refreshed provider availability again.",
};

function makeBackgroundPolicyLayer(shouldRunScopeWork: boolean) {
  return Layer.mock(BackgroundPolicy.BackgroundPolicy)({
    reportClientActivity: () => Effect.void,
    removeRpcClient: () => Effect.void,
    reportHostPowerState: () => Effect.void,
    snapshot: Effect.succeed({
      hostPower: {
        source: "unknown",
        idle: "unknown",
        idleSeconds: null,
        locked: "unknown",
        suspended: false,
        onBattery: "unknown",
        lowPowerMode: "unknown",
        thermalState: "unknown",
        stale: true,
        updatedAt: TEST_EPOCH,
      },
      leases: [],
      activeForegroundLeaseCount: 0,
      activeScopeKeys: [],
      shouldRunOpportunisticWork: true,
      updatedAt: TEST_EPOCH,
    }),
    streamChanges: Stream.empty,
    hasDemand: () => Effect.succeed(shouldRunScopeWork),
    shouldRunScopeWork: () => Effect.succeed(shouldRunScopeWork),
    shouldRunOpportunisticWork: Effect.succeed(shouldRunScopeWork),
  });
}

const BackgroundPolicyAlwaysRunLayer = makeBackgroundPolicyLayer(true);
const BackgroundPolicyNeverRunLayer = makeBackgroundPolicyLayer(false);
const ServerSettingsTestLayer = ServerSettingsService.layerTest();
const AlwaysRunTestLayer = Layer.merge(BackgroundPolicyAlwaysRunLayer, ServerSettingsTestLayer);
const NeverRunTestLayer = Layer.merge(BackgroundPolicyNeverRunLayer, ServerSettingsTestLayer);

const enrichedSnapshotSecond: ServerProvider = {
  ...refreshedSnapshotSecond,
  checkedAt: "2026-04-10T00:00:04.000Z",
  models: [
    {
      slug: "gpt-5.4",
      name: "GPT-5.4",
      isCustom: false,
      capabilities: emptyCapabilities,
    },
  ],
};

const timeoutSnapshot: ServerProvider = {
  ...initialSnapshot,
  status: "error",
  message: "Timed out while checking provider status.",
};

const makeRecoveryFixture = Effect.fn(function* (
  snapshots: ReadonlyArray<ServerProvider>,
  previous: ServerProvider = enrichedSnapshot,
  settingsAffectProbe = true,
) {
  const checkCalls = yield* Ref.make(0);
  const settingsRef = yield* Ref.make<TestSettings>({ enabled: true });
  const settingsChanges = yield* PubSub.unbounded<TestSettings>();
  const provider = yield* makeManagedServerProvider<TestSettings>({
    resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
    getSettings: Ref.get(settingsRef),
    streamSettings: Stream.fromPubSub(settingsChanges),
    haveSettingsChanged: (before, after) =>
      before.enabled !== after.enabled || before.updateChecks !== after.updateChecks,
    ...(settingsAffectProbe ? {} : { checkProviderOnSettingsChange: () => false }),
    initialSnapshot: () => Effect.succeed(previous),
    checkProvider: Effect.gen(function* () {
      const count = yield* Ref.updateAndGet(checkCalls, (value) => value + 1);
      const settings = yield* Ref.get(settingsRef);
      return settings.enabled
        ? snapshots[Math.min(count - 1, snapshots.length - 1)]!
        : { ...initialSnapshot, enabled: false, status: "disabled" as const };
    }),
    refreshInterval: "1 hour",
  });
  return { provider, checkCalls, settingsRef, settingsChanges };
});

const nextProviderSnapshot = (provider: {
  readonly streamChanges: Stream.Stream<ServerProvider>;
}) =>
  provider.streamChanges.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map((snapshots) => Array.from(snapshots)[0]!),
  );

const RecoveryTestLayer = Layer.mergeAll(AlwaysRunTestLayer, TestClock.layer());

describe("makeManagedServerProvider", () => {
  for (const [driver, message] of [
    ["cursor", "Cursor Agent CLI is installed but timed out while running `agent about`."],
    ["codex", "Timed out while checking Codex app-server provider status."],
    ["opencode", "Failed to execute OpenCode CLI health check: version probe timed out."],
    [
      "claudeAgent",
      "Claude Agent CLI is installed but failed to run. Timed out while running command.",
    ],
    ["grok", "Grok CLI is installed but timed out while running `grok --version`."],
    ["antigravity", "Antigravity did not respond to its local health check within 10 seconds."],
  ] as const) {
    it.effect(`automatically recovers ${driver} after a transient health-check timeout`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const identity = {
            driver: ProviderDriverKind.make(driver),
            instanceId: ProviderInstanceId.make(driver),
          };
          const healthy = { ...enrichedSnapshot, ...identity };
          const recovered = { ...enrichedSnapshotSecond, ...identity };
          const { provider, checkCalls } = yield* makeRecoveryFixture(
            [{ ...timeoutSnapshot, ...identity, message }, recovered],
            healthy,
          );

          const rechecking = yield* nextProviderSnapshot(provider);
          assert.strictEqual(rechecking.status, "warning");
          assert.deepStrictEqual(rechecking.models, healthy.models);
          assert.deepStrictEqual(rechecking.auth, healthy.auth);
          assert.strictEqual(rechecking.version, healthy.version);
          assert.include(rechecking.message!, message);

          const recovery = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
          yield* TestClock.adjust("2 seconds");
          assert.deepStrictEqual(yield* Fiber.join(recovery), recovered);
          assert.deepStrictEqual(yield* provider.getSnapshot, recovered);
          assert.strictEqual(yield* Ref.get(checkCalls), 2);
        }),
      ).pipe(Effect.provide(RecoveryTestLayer)),
    );
  }

  it.effect("rechecks a temporarily unreachable configured OpenCode server", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider } = yield* makeRecoveryFixture([
          {
            ...timeoutSnapshot,
            driver: ProviderDriverKind.make("opencode"),
            message:
              "Couldn't reach the configured OpenCode server at http://localhost:4096. Check that the server is running and the URL is correct.",
          },
          refreshedSnapshot,
        ]);
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        const recovery = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        assert.strictEqual((yield* Fiber.join(recovery)).status, "ready");
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("reports the original failure after two unsuccessful automatic retries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, checkCalls } = yield* makeRecoveryFixture([timeoutSnapshot]);
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        const retry = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        assert.strictEqual((yield* Fiber.join(retry)).status, "warning");
        assert.strictEqual(yield* Ref.get(checkCalls), 2);

        const exhausted = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
        yield* TestClock.adjust("5 seconds");
        assert.deepStrictEqual(yield* Fiber.join(exhausted), timeoutSnapshot);
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(yield* Ref.get(checkCalls), 3);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  for (const [label, failure] of [
    ["missing binary", { ...timeoutSnapshot, installed: false }],
    [
      "authentication failure",
      { ...timeoutSnapshot, auth: { status: "unauthenticated" as const } },
    ],
    ["incompatible CLI", { ...timeoutSnapshot, message: "This CLI version is too old." }],
  ] as const) {
    it.effect(`does not automatically retry a ${label}`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { provider, checkCalls } = yield* makeRecoveryFixture([failure]);
          assert.deepStrictEqual(yield* nextProviderSnapshot(provider), failure);
          yield* TestClock.adjust("1 minute");
          assert.strictEqual(yield* Ref.get(checkCalls), 1);
        }),
      ).pipe(Effect.provide(RecoveryTestLayer)),
    );
  }

  it.effect("discards a pending retry after a successful manual refresh", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, checkCalls } = yield* makeRecoveryFixture([
          timeoutSnapshot,
          refreshedSnapshot,
        ]);
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        assert.deepStrictEqual(yield* provider.refresh, refreshedSnapshot);
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
        assert.deepStrictEqual(yield* provider.getSnapshot, refreshedSnapshot);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("discards recovery when the provider is disabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, checkCalls, settingsRef, settingsChanges } = yield* makeRecoveryFixture([
          timeoutSnapshot,
        ]);
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        const disabled = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
        yield* Ref.set(settingsRef, { enabled: false });
        yield* PubSub.publish(settingsChanges, { enabled: false });
        assert.strictEqual((yield* Fiber.join(disabled)).status, "disabled");
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("keeps authentication unknown until a first successful check", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider } = yield* makeRecoveryFixture(
          [timeoutSnapshot, refreshedSnapshot],
          initialSnapshot,
        );
        const rechecking = yield* nextProviderSnapshot(provider);
        assert.strictEqual(rechecking.status, "warning");
        assert.strictEqual(rechecking.auth.status, "unknown");
        assert.strictEqual(rechecking.version, null);
        const recovery = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        assert.strictEqual((yield* Fiber.join(recovery)).auth.status, "authenticated");
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("stops recovery if a retry reports an authentication failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const unauthenticated = {
          ...timeoutSnapshot,
          auth: { status: "unauthenticated" as const },
          message: "Sign in again.",
        };
        const { provider, checkCalls } = yield* makeRecoveryFixture([
          timeoutSnapshot,
          unauthenticated,
        ]);
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        const failure = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        assert.deepStrictEqual(yield* Fiber.join(failure), unauthenticated);
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("cancels recovery when its provider scope closes", () =>
    Effect.gen(function* () {
      const checkCalls = yield* Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* makeRecoveryFixture([timeoutSnapshot]);
          assert.strictEqual((yield* nextProviderSnapshot(fixture.provider)).status, "warning");
          return fixture.checkCalls;
        }),
      );
      yield* TestClock.adjust("1 minute");
      assert.strictEqual(yield* Ref.get(checkCalls), 1);
    }).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("continues bounded recovery when only enrichment settings change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, checkCalls, settingsRef, settingsChanges } = yield* makeRecoveryFixture(
          [timeoutSnapshot, refreshedSnapshot],
          enrichedSnapshot,
          false,
        );
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        const settings = { enabled: true, updateChecks: false };
        yield* Ref.set(settingsRef, settings);
        yield* PubSub.publish(settingsChanges, settings);
        yield* TestClock.adjust("10 seconds");
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
        assert.deepStrictEqual(yield* provider.getSnapshot, refreshedSnapshot);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("keeps rechecking status when enrichment republishes a transient failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const callbacks: Array<(snapshot: ServerProvider) => Effect.Effect<void>> = [];
        const callbackReady = yield* Deferred.make<void>();
        const checkCalls = yield* Ref.make(0);
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (before, after) => before.enabled !== after.enabled,
          initialSnapshot: () => Effect.succeed(enrichedSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.map((count) => (count === 1 ? timeoutSnapshot : refreshedSnapshot)),
          ),
          enrichSnapshot: ({ publishSnapshot }) =>
            Effect.gen(function* () {
              callbacks.push(publishSnapshot);
              yield* Deferred.succeed(callbackReady, undefined);
            }),
          refreshInterval: "1 hour",
        });
        const rechecking = yield* nextProviderSnapshot(provider);
        assert.strictEqual(rechecking.status, "warning");
        yield* Deferred.await(callbackReady);
        yield* callbacks[0]!(timeoutSnapshot);
        assert.strictEqual((yield* provider.getSnapshot).status, "warning");
        assert.deepStrictEqual((yield* provider.getSnapshot).models, enrichedSnapshot.models);
        yield* callbacks[0]!(rechecking);
        assert.strictEqual((yield* provider.getSnapshot).message, rechecking.message);

        const recovery = yield* nextProviderSnapshot(provider).pipe(Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        assert.deepStrictEqual(yield* Fiber.join(recovery), refreshedSnapshot);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("skips a pending retry after session metadata confirms provider health", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const callback = yield* Deferred.make<(snapshot: ServerProvider) => Effect.Effect<void>>();
        const checkCalls = yield* Ref.make(0);
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (before, after) => before.enabled !== after.enabled,
          initialSnapshot: () => Effect.succeed(enrichedSnapshot),
          checkProvider: Ref.update(checkCalls, (count) => count + 1).pipe(
            Effect.as(timeoutSnapshot),
          ),
          enrichSnapshot: ({ publishSnapshot }) =>
            Deferred.succeed(callback, publishSnapshot).pipe(Effect.asVoid),
          refreshInterval: "1 hour",
        });
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        const publish = yield* Deferred.await(callback);
        yield* publish(refreshedSnapshot);
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(yield* Ref.get(checkCalls), 1);
        assert.deepStrictEqual(yield* provider.getSnapshot, refreshedSnapshot);
        yield* publish(timeoutSnapshot);
        assert.deepStrictEqual(yield* provider.getSnapshot, timeoutSnapshot);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect("does not let a delayed recovery overwrite newer session health", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const callback = yield* Deferred.make<(snapshot: ServerProvider) => Effect.Effect<void>>();
        const retryEntered = yield* Deferred.make<void>();
        const releaseRetry = yield* Deferred.make<void>();
        const checkCalls = yield* Ref.make(0);
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (before, after) => before.enabled !== after.enabled,
          initialSnapshot: () => Effect.succeed(enrichedSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 2
                ? Deferred.succeed(retryEntered, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseRetry)),
                    Effect.as(timeoutSnapshot),
                  )
                : Effect.succeed(count === 1 ? timeoutSnapshot : refreshedSnapshotSecond),
            ),
          ),
          enrichSnapshot: ({ publishSnapshot }) =>
            Deferred.succeed(callback, publishSnapshot).pipe(Effect.asVoid),
          refreshInterval: "1 hour",
        });
        assert.strictEqual((yield* nextProviderSnapshot(provider)).status, "warning");
        const publish = yield* Deferred.await(callback);
        yield* TestClock.adjust("2 seconds");
        yield* Deferred.await(retryEntered);
        const updates = yield* provider.streamChanges.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* publish(refreshedSnapshot);
        const manualRefresh = yield* provider.refresh.pipe(Effect.forkChild);
        yield* Deferred.succeed(releaseRetry, undefined);
        yield* Fiber.join(manualRefresh);
        assert.deepStrictEqual(Array.from(yield* Fiber.join(updates)), [
          refreshedSnapshot,
          refreshedSnapshotSecond,
        ]);
      }),
    ).pipe(Effect.provide(RecoveryTestLayer)),
  );

  it.effect(
    "runs the initial provider check in the background and streams the refreshed snapshot",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const checkCalls = yield* Ref.make(0);
          const releaseCheck = yield* Deferred.make<void>();
          const provider = yield* makeManagedServerProvider<TestSettings>({
            resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
            getSettings: Effect.succeed({ enabled: true }),
            streamSettings: Stream.empty,
            haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
            initialSnapshot: () => Effect.succeed(initialSnapshot),
            checkProvider: Ref.update(checkCalls, (count) => count + 1).pipe(
              Effect.flatMap(() => Deferred.await(releaseCheck)),
              Effect.as(refreshedSnapshot),
            ),
            refreshInterval: "1 hour",
          });

          const initial = yield* provider.getSnapshot;
          assert.deepStrictEqual(initial, initialSnapshot);

          const updatesFiber = yield* Stream.take(provider.streamChanges, 1).pipe(
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* Effect.yieldNow;
          assert.strictEqual(yield* Ref.get(checkCalls), 1);

          yield* Deferred.succeed(releaseCheck, undefined);

          const updates = Array.from(yield* Fiber.join(updatesFiber));
          const latest = yield* provider.getSnapshot;

          assert.deepStrictEqual(updates, [refreshedSnapshot]);
          assert.deepStrictEqual(latest, refreshedSnapshot);
          assert.strictEqual(yield* Ref.get(checkCalls), 1);
        }),
      ).pipe(Effect.provide(AlwaysRunTestLayer)),
  );

  it.effect("skips periodic provider refreshes without foreground provider-status demand", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)
                : Effect.void,
            ),
            Effect.as(refreshedSnapshot),
          ),
          refreshInterval: "1 second",
        });

        yield* Deferred.await(initialCheckDone);
        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;

        assert.strictEqual(yield* Ref.get(checkCalls), 1);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(NeverRunTestLayer, TestClock.layer()))),
  );

  it.effect("disables periodic provider refreshes when the explicit interval is zero", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap(() => Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)),
            Effect.as(refreshedSnapshot),
          ),
          refreshInterval: 0,
        });

        yield* Deferred.await(initialCheckDone);
        yield* TestClock.adjust("5 minutes");
        yield* Effect.yieldNow;

        assert.strictEqual(yield* Ref.get(checkCalls), 1);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(AlwaysRunTestLayer, TestClock.layer()))),
  );

  it.effect("keeps manual refresh when interval refresh is disabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)
                : Effect.void,
            ),
            Effect.as(refreshedSnapshot),
          ),
          refreshInterval: "1 second",
          refreshOnInterval: false,
        });

        yield* Deferred.await(initialCheckDone);
        yield* TestClock.adjust("5 minutes");
        yield* Effect.yieldNow;
        assert.strictEqual(yield* Ref.get(checkCalls), 1);

        yield* provider.refresh;
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(AlwaysRunTestLayer, TestClock.layer()))),
  );

  it.effect("wakes a sleeping provider refresh loop when its interval changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initialServerSettings = {
          ...DEFAULT_SERVER_SETTINGS,
          providerHealthRefreshInterval: Duration.hours(1),
        };
        const serverSettingsRef = yield* Ref.make(initialServerSettings);
        const serverSettingsChanges = yield* PubSub.unbounded<typeof initialServerSettings>();
        const serverSettingsLayer = Layer.succeed(
          ServerSettingsService,
          ServerSettingsService.of({
            start: Effect.void,
            ready: Effect.void,
            getSettings: Ref.get(serverSettingsRef),
            getPersistedSettings: Ref.get(serverSettingsRef),
            updateSettings: () => Effect.die(new Error("unused in this test")),
            streamChanges: Stream.empty,
            subscribeChanges: PubSub.subscribe(serverSettingsChanges).pipe(
              Effect.map((subscription) => Stream.fromSubscription(subscription)),
            ),
          }),
        );
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        const periodicCheckDone = yield* Deferred.make<void>();

        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)
                : Deferred.succeed(periodicCheckDone, undefined).pipe(Effect.ignore),
            ),
            Effect.as(refreshedSnapshot),
          ),
        }).pipe(Effect.provide(Layer.merge(BackgroundPolicyAlwaysRunLayer, serverSettingsLayer)));

        yield* Deferred.await(initialCheckDone);
        const nextServerSettings = {
          ...initialServerSettings,
          providerHealthRefreshInterval: Duration.seconds(1),
        };
        yield* Ref.set(serverSettingsRef, nextServerSettings);
        yield* PubSub.publish(serverSettingsChanges, nextServerSettings);
        yield* Effect.yieldNow;

        yield* TestClock.adjust("999 millis");
        assert.strictEqual(yield* Ref.get(checkCalls), 1);
        yield* TestClock.adjust("1 millis");
        yield* Deferred.await(periodicCheckDone);
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reruns the provider check when streamed settings change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settingsRef = yield* Ref.make<TestSettings>({ enabled: true });
        const settingsChanges = yield* PubSub.unbounded<TestSettings>();
        const checkCalls = yield* Ref.make(0);
        const releaseInitialCheck = yield* Deferred.make<void>();
        const releaseSettingsCheck = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Ref.get(settingsRef),
          streamSettings: Stream.fromPubSub(settingsChanges),
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Deferred.await(releaseInitialCheck).pipe(Effect.as(refreshedSnapshot))
                : Deferred.await(releaseSettingsCheck).pipe(Effect.as(refreshedSnapshotSecond)),
            ),
          ),
          refreshInterval: "1 hour",
        });

        const updatesFiber = yield* Stream.take(provider.streamChanges, 2).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        yield* Deferred.succeed(releaseInitialCheck, undefined);
        yield* Ref.set(settingsRef, { enabled: false });
        yield* PubSub.publish(settingsChanges, { enabled: false });
        yield* Deferred.succeed(releaseSettingsCheck, undefined);

        const updates = Array.from(yield* Fiber.join(updatesFiber));
        const latest = yield* provider.getSnapshot;

        assert.deepStrictEqual(updates, [refreshedSnapshot, refreshedSnapshotSecond]);
        assert.deepStrictEqual(latest, refreshedSnapshotSecond);
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(AlwaysRunTestLayer)),
  );

  it.effect("can update settings and disable periodic checks without probing again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settingsChanges = yield* PubSub.unbounded<TestSettings>();
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        const enrichmentCalls = yield* Ref.make(0);
        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.fromPubSub(settingsChanges),
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          checkProviderOnSettingsChange: () => false,
          refreshOnInterval: false,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap(() => Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)),
            Effect.as(refreshedSnapshot),
          ),
          enrichSnapshot: () => Ref.update(enrichmentCalls, (count) => count + 1),
          refreshInterval: "1 second",
        });

        yield* Deferred.await(initialCheckDone);
        yield* PubSub.publish(settingsChanges, { enabled: false });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;

        assert.strictEqual(yield* Ref.get(checkCalls), 1);
        assert.strictEqual(yield* Ref.get(enrichmentCalls), 2);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(AlwaysRunTestLayer, TestClock.layer()))),
  );

  it.effect("streams supplemental snapshot updates after the base provider check completes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const releaseEnrichment = yield* Deferred.make<void>();
        const releaseCheck = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Deferred.await(releaseCheck).pipe(Effect.as(refreshedSnapshot)),
          enrichSnapshot: ({ publishSnapshot }) =>
            Deferred.await(releaseEnrichment).pipe(
              Effect.flatMap(() => publishSnapshot(enrichedSnapshot)),
            ),
          refreshInterval: "1 hour",
        });

        const updatesFiber = yield* Stream.take(provider.streamChanges, 2).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        yield* Deferred.succeed(releaseCheck, undefined);

        yield* Deferred.succeed(releaseEnrichment, undefined);

        const updates = Array.from(yield* Fiber.join(updatesFiber));
        const latest = yield* provider.getSnapshot;

        assert.deepStrictEqual(updates, [refreshedSnapshot, enrichedSnapshot]);
        assert.deepStrictEqual(latest, enrichedSnapshot);
      }),
    ).pipe(Effect.provide(AlwaysRunTestLayer)),
  );

  it.effect("ignores stale enrichment callbacks after a newer refresh advances generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publishCallbacks: Array<(snapshot: ServerProvider) => Effect.Effect<void>> = [];
        const refreshCount = yield* Ref.make(0);
        const firstCallbackReady = yield* Deferred.make<void>();
        const secondCallbackReady = yield* Deferred.make<void>();
        const allowFirstRefresh = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(refreshCount, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Deferred.await(allowFirstRefresh).pipe(Effect.as(refreshedSnapshot))
                : Effect.succeed(refreshedSnapshotSecond),
            ),
          ),
          enrichSnapshot: ({ publishSnapshot }) =>
            Effect.gen(function* () {
              publishCallbacks.push(publishSnapshot);
              if (publishCallbacks.length === 1) {
                yield* Deferred.succeed(firstCallbackReady, undefined).pipe(Effect.ignore);
              } else if (publishCallbacks.length === 2) {
                yield* Deferred.succeed(secondCallbackReady, undefined).pipe(Effect.ignore);
              }
            }),
          refreshInterval: "1 hour",
        });

        const updatesFiber = yield* Stream.take(provider.streamChanges, 3).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        yield* Deferred.succeed(allowFirstRefresh, undefined);
        yield* Deferred.await(firstCallbackReady);

        yield* provider.refresh;
        yield* Deferred.await(secondCallbackReady);

        yield* publishCallbacks[0]!(enrichedSnapshot);
        yield* publishCallbacks[1]!(enrichedSnapshotSecond);

        const updates = Array.from(yield* Fiber.join(updatesFiber));
        const latest = yield* provider.getSnapshot;

        assert.deepStrictEqual(updates, [
          refreshedSnapshot,
          refreshedSnapshotSecond,
          enrichedSnapshotSecond,
        ]);
        assert.deepStrictEqual(latest, enrichedSnapshotSecond);
      }),
    ).pipe(Effect.provide(AlwaysRunTestLayer)),
  );

  it.effect("applies runtime usage updates onto the published snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Effect.succeed({
            ...refreshedSnapshot,
            usageLimits: {
              checkedAt: "2026-04-10T00:00:01.000Z",
              windows: [
                { id: "five_hour", kind: "session", label: "Session", usedPercent: 10 },
                {
                  id: "seven_day",
                  kind: "weekly",
                  label: "Weekly",
                  usedPercent: 20,
                  resetsAt: "2026-04-17T00:00:00.000Z",
                },
              ],
            },
          } satisfies ServerProvider),
          refreshInterval: "1 hour",
        });
        yield* Stream.take(provider.streamChanges, 1).pipe(Stream.runDrain);

        const updatesFiber = yield* Stream.take(provider.streamChanges, 1).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        // Percent-only weekly update: keeps the probe's reset time.
        yield* provider.applyUsageLimits({
          checkedAt: "2026-04-10T00:05:00.000Z",
          windows: [{ id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 25 }],
        });
        // No windows: nothing to merge, nothing published.
        yield* provider.applyUsageLimits({ checkedAt: "2026-04-10T00:06:00.000Z", windows: [] });

        const [update] = Array.from(yield* Fiber.join(updatesFiber));
        assert.deepStrictEqual(update?.usageLimits, {
          checkedAt: "2026-04-10T00:05:00.000Z",
          windows: [
            { id: "five_hour", kind: "session", label: "Session", usedPercent: 10 },
            {
              id: "seven_day",
              kind: "weekly",
              label: "Weekly",
              usedPercent: 25,
              resetsAt: "2026-04-17T00:00:00.000Z",
            },
          ],
        });
        assert.deepStrictEqual(yield* provider.getSnapshot, update);
      }),
    ).pipe(Effect.provide(AlwaysRunTestLayer)),
  );

  it.effect("keeps live usage windows across a failed probe and a stale enrichment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const releaseEnrichment = yield* Deferred.make<void>();
        const refreshCount = yield* Ref.make(0);
        const probedLimits = {
          checkedAt: "2026-04-10T00:00:01.000Z",
          windows: [{ id: "primary", kind: "session", label: "Session", usedPercent: 10 }],
        } as const;
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(refreshCount, (count) => count + 1).pipe(
            Effect.map((count) =>
              count === 1
                ? { ...refreshedSnapshot, usageLimits: probedLimits }
                : {
                    ...refreshedSnapshotSecond,
                    usageLimits: {
                      checkedAt: "2026-04-10T00:00:03.000Z",
                      windows: [],
                      unavailable: { reason: "probeFailed" },
                    },
                  },
            ),
          ),
          enrichSnapshot: ({ snapshot, publishSnapshot }) =>
            Deferred.await(releaseEnrichment).pipe(
              Effect.flatMap(() =>
                publishSnapshot({
                  ...enrichedSnapshot,
                  ...snapshot,
                  models: enrichedSnapshot.models,
                }),
              ),
            ),
          refreshInterval: "1 hour",
        });
        yield* Stream.take(provider.streamChanges, 1).pipe(Stream.runDrain);

        const liveWindow = {
          id: "primary",
          kind: "session",
          label: "Session",
          usedPercent: 60,
        } as const;
        yield* provider.applyUsageLimits({
          checkedAt: "2026-04-10T00:00:02.000Z",
          windows: [liveWindow],
        });

        // Enrichment computed from the pre-update snapshot lands afterwards.
        yield* Deferred.succeed(releaseEnrichment, undefined);
        const enriched = yield* Stream.take(provider.streamChanges, 1).pipe(
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk)[0]!),
        );
        assert.deepStrictEqual(enriched.models, enrichedSnapshot.models);
        assert.deepStrictEqual(enriched.usageLimits?.windows, [liveWindow]);

        // A probe that could not read usage keeps the last good windows.
        const refreshed = yield* provider.refresh;
        assert.strictEqual(refreshed.message, refreshedSnapshotSecond.message);
        assert.deepStrictEqual(refreshed.usageLimits?.windows, [liveWindow]);
      }),
    ).pipe(Effect.provide(AlwaysRunTestLayer)),
  );
});
