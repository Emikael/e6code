import {
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  type ServerProvider,
  ServerSettingsError,
} from "@e6tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@e6tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { applyUsageLimitsUpdate, resolveUsageLimitsAfterProbe } from "./providerUsageLimits.ts";
import type { ServerProviderShape } from "./Services/ServerProvider.ts";

interface ProviderSnapshotState {
  readonly snapshot: ServerProvider;
  readonly enrichmentGeneration: number;
  readonly recoveryAttempt?: number;
}

const HEALTH_CHECK_RECOVERY_DELAYS = ["2 seconds", "5 seconds"] as const;

interface ProviderRecoveryAttempt<Settings> {
  readonly settings: Settings;
  readonly generation: number;
  readonly attempt: number;
}

function isRetryableHealthCheck(snapshot: ServerProvider): boolean {
  if (
    !snapshot.enabled ||
    !snapshot.installed ||
    snapshot.status === "ready" ||
    snapshot.status === "disabled" ||
    snapshot.auth.status === "unauthenticated"
  ) {
    return false;
  }
  // Probes expose failures as status snapshots, so only their explicit
  // timeout/unreachable messages qualify; setup errors need user action.
  const message = snapshot.message ?? "";
  return (
    /\btimed out\b|\btimeout\b|did not respond to its local health check within/i.test(message) ||
    (snapshot.driver === "opencode" &&
      message.startsWith("Couldn't reach the configured OpenCode server"))
  );
}

function recheckingSnapshot(
  probed: ServerProvider,
  previous: ServerProvider | undefined,
  attempt: number,
): ServerProvider {
  const retained =
    previous?.instanceId === probed.instanceId &&
    previous.driver === probed.driver &&
    previous.installed &&
    (previous.status === "ready" ||
      (previous.status === "warning" && previous.auth.status === "authenticated"))
      ? previous
      : probed;
  return {
    ...retained,
    checkedAt: probed.checkedAt,
    status: "warning",
    message: `${probed.message} Automatically rechecking (${attempt}/${HEALTH_CHECK_RECOVERY_DELAYS.length}).`,
  };
}

function withUsageLimits(
  snapshot: ServerProvider,
  usageLimits: ServerProvider["usageLimits"],
): ServerProvider {
  if (snapshot.usageLimits === usageLimits) {
    return snapshot;
  }
  const { usageLimits: _previous, ...rest } = snapshot;
  return usageLimits ? { ...rest, usageLimits } : rest;
}

export const makeManagedServerProvider = Effect.fn("makeManagedServerProvider")(function* <
  Settings,
>(input: {
  readonly resolveMaintenance: ServerProviderShape["resolveMaintenance"];
  readonly getSettings: Effect.Effect<Settings, ServerSettingsError>;
  readonly streamSettings: Stream.Stream<Settings>;
  readonly haveSettingsChanged: (previous: Settings, next: Settings) => boolean;
  readonly initialSnapshot: (settings: Settings) => Effect.Effect<ServerProvider>;
  readonly checkProvider: Effect.Effect<ServerProvider, ServerSettingsError>;
  readonly enrichSnapshot?: (input: {
    readonly settings: Settings;
    readonly snapshot: ServerProvider;
    readonly getSnapshot: Effect.Effect<ServerProvider>;
    readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  }) => Effect.Effect<void>;
  readonly refreshInterval?: Duration.Input;
  readonly refreshOnInterval?: boolean;
  readonly checkProviderOnSettingsChange?: (previous: Settings, next: Settings) => boolean;
}): Effect.fn.Return<
  ServerProviderShape,
  ServerSettingsError,
  Scope.Scope | BackgroundPolicy.BackgroundPolicy | ServerSettingsService
> {
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const serverSettings = yield* ServerSettingsService;
  const refreshSemaphore = yield* Semaphore.make(1);
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<ServerProvider>(),
    PubSub.shutdown,
  );
  const initialSettings = yield* input.getSettings;
  const initialSnapshot = yield* input.initialSnapshot(initialSettings);
  const snapshotStateRef = yield* Ref.make<ProviderSnapshotState>({
    snapshot: initialSnapshot,
    enrichmentGeneration: 0,
  });
  const settingsRef = yield* Ref.make(initialSettings);
  const recoveryAttempts = yield* Effect.acquireRelease(
    Queue.sliding<ProviderRecoveryAttempt<Settings>>(1),
    Queue.shutdown,
  );
  const enrichmentFiberRef = yield* Ref.make<Fiber.Fiber<void, unknown> | null>(null);
  const scope = yield* Effect.scope;

  const publishEnrichedSnapshot = Effect.fn("publishEnrichedSnapshot")(function* (
    generation: number,
    nextSnapshot: ServerProvider,
  ) {
    const snapshotToPublish = yield* Ref.modify(snapshotStateRef, (state) => {
      if (state.enrichmentGeneration !== generation) {
        return [null, state] as const;
      }
      // Enrichment derives from the snapshot it was handed; a runtime usage
      // update that landed since must not be reverted by it.
      const merged = withUsageLimits(
        state.recoveryAttempt !== undefined && isRetryableHealthCheck(nextSnapshot)
          ? {
              ...recheckingSnapshot(nextSnapshot, state.snapshot, state.recoveryAttempt),
              message: state.snapshot.message,
            }
          : nextSnapshot,
        state.snapshot.usageLimits,
      );
      if (Equal.equals(state.snapshot, merged)) {
        return [null, state] as const;
      }
      return [
        merged,
        {
          snapshot: merged,
          enrichmentGeneration: state.enrichmentGeneration,
          ...(state.recoveryAttempt !== undefined && isRetryableHealthCheck(merged)
            ? { recoveryAttempt: state.recoveryAttempt }
            : {}),
        },
      ] as const;
    });
    if (snapshotToPublish === null) {
      return;
    }
    yield* PubSub.publish(changesPubSub, snapshotToPublish);
  });

  const restartSnapshotEnrichment = Effect.fn("restartSnapshotEnrichment")(function* (
    settings: Settings,
    snapshot: ServerProvider,
    generation: number,
  ) {
    const previousFiber = yield* Ref.getAndSet(enrichmentFiberRef, null);
    if (previousFiber) {
      yield* Fiber.interrupt(previousFiber).pipe(Effect.ignore);
    }

    if (!input.enrichSnapshot) {
      return;
    }

    const fiber = yield* input
      .enrichSnapshot({
        settings,
        snapshot,
        getSnapshot: Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot)),
        publishSnapshot: (nextSnapshot) => publishEnrichedSnapshot(generation, nextSnapshot),
      })
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(scope));

    yield* Ref.set(enrichmentFiberRef, fiber);
  });

  const applySnapshotBase = Effect.fn("applySnapshot")(function* (
    nextSettings: Settings,
    options?: {
      readonly forceRefresh?: boolean;
      readonly recovery?: ProviderRecoveryAttempt<Settings>;
    },
  ) {
    const forceRefresh = options?.forceRefresh === true;
    const previousSettings = yield* Ref.get(settingsRef);
    const settingsChanged = input.haveSettingsChanged(previousSettings, nextSettings);
    if (options?.recovery) {
      const state = yield* Ref.get(snapshotStateRef);
      if (
        state.enrichmentGeneration !== options.recovery.generation ||
        state.recoveryAttempt !== options.recovery.attempt ||
        !isRetryableHealthCheck(state.snapshot) ||
        input.haveSettingsChanged(options.recovery.settings, nextSettings)
      ) {
        return state.snapshot;
      }
    }
    if (!forceRefresh && !settingsChanged) {
      yield* Ref.set(settingsRef, nextSettings);
      return yield* Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot));
    }

    if (
      !forceRefresh &&
      input.checkProviderOnSettingsChange?.(previousSettings, nextSettings) === false
    ) {
      const state = yield* Ref.get(snapshotStateRef);
      const nextGeneration = state.enrichmentGeneration + 1;
      yield* Ref.set(snapshotStateRef, {
        ...state,
        enrichmentGeneration: nextGeneration,
      });
      yield* Ref.set(settingsRef, nextSettings);
      if (state.recoveryAttempt !== undefined && isRetryableHealthCheck(state.snapshot)) {
        yield* Queue.offer(recoveryAttempts, {
          settings: nextSettings,
          generation: nextGeneration,
          attempt: state.recoveryAttempt,
        });
      }
      yield* restartSnapshotEnrichment(nextSettings, state.snapshot, nextGeneration);
      return state.snapshot;
    }

    const probedSnapshot = yield* input.checkProvider;
    const nextAttempt = (options?.recovery?.attempt ?? 0) + 1;
    const shouldRecover =
      isRetryableHealthCheck(probedSnapshot) && nextAttempt <= HEALTH_CHECK_RECOVERY_DELAYS.length;
    const applied = yield* Ref.modify(snapshotStateRef, (state) => {
      if (
        options?.recovery &&
        (state.enrichmentGeneration !== options.recovery.generation ||
          state.recoveryAttempt !== options.recovery.attempt)
      ) {
        return [null, state] as const;
      }
      const generation = state.enrichmentGeneration + 1;
      const snapshot = withUsageLimits(
        shouldRecover
          ? recheckingSnapshot(
              probedSnapshot,
              settingsChanged ? undefined : state.snapshot,
              nextAttempt,
            )
          : probedSnapshot,
        resolveUsageLimitsAfterProbe({
          published: state.snapshot.usageLimits,
          probed: probedSnapshot.usageLimits,
        }),
      );
      return [
        { snapshot, generation },
        {
          snapshot,
          enrichmentGeneration: generation,
          ...(shouldRecover ? { recoveryAttempt: nextAttempt } : {}),
        },
      ] as const;
    });
    if (applied === null) {
      return yield* Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot));
    }
    const { snapshot: nextSnapshot, generation: nextGeneration } = applied;
    yield* Ref.set(settingsRef, nextSettings);
    yield* PubSub.publish(changesPubSub, nextSnapshot);
    if (shouldRecover) {
      yield* Queue.offer(recoveryAttempts, {
        settings: nextSettings,
        generation: nextGeneration,
        attempt: nextAttempt,
      });
    }
    yield* restartSnapshotEnrichment(nextSettings, nextSnapshot, nextGeneration);
    return nextSnapshot;
  });
  const applySnapshot = (
    nextSettings: Settings,
    options?: {
      readonly forceRefresh?: boolean;
      readonly recovery?: ProviderRecoveryAttempt<Settings>;
    },
  ) => refreshSemaphore.withPermits(1)(applySnapshotBase(nextSettings, options));

  // Delay outside the refresh lock so a manual refresh or settings change
  // can supersede recovery. The generation is checked under that same lock.
  yield* Effect.forever(
    Effect.gen(function* () {
      const recovery = yield* Queue.take(recoveryAttempts);
      yield* Effect.sleep(HEALTH_CHECK_RECOVERY_DELAYS[recovery.attempt - 1]!);
      const settings = yield* input.getSettings;
      yield* applySnapshot(settings, { forceRefresh: true, recovery });
    }).pipe(Effect.ignoreCause({ log: true })),
  ).pipe(Effect.forkScoped);

  /**
   * Runtime usage updates arrive between probes. They patch only
   * `usageLimits` on whatever snapshot is published and leave the enrichment
   * generation alone, so an in-flight enrichment still lands.
   */
  const applyUsageLimits: ServerProviderShape["applyUsageLimits"] = (update) =>
    Effect.gen(function* () {
      const snapshotToPublish = yield* Ref.modify(snapshotStateRef, (state) => {
        const usageLimits = applyUsageLimitsUpdate({
          previous: state.snapshot.usageLimits,
          update,
          checkedAt: update.checkedAt,
        });
        // `applyUsageLimitsUpdate` hands back the same object when nothing
        // moved, which is the common case for Codex's per-tick notification.
        if (usageLimits === state.snapshot.usageLimits) {
          return [null, state] as const;
        }
        const snapshot = withUsageLimits(state.snapshot, usageLimits);
        return [snapshot, { ...state, snapshot }] as const;
      });
      if (snapshotToPublish !== null) {
        yield* PubSub.publish(changesPubSub, snapshotToPublish);
      }
    });

  const refreshSnapshot = Effect.fn("refreshSnapshot")(function* () {
    const nextSettings = yield* input.getSettings;
    return yield* applySnapshot(nextSettings, { forceRefresh: true });
  });

  const hasProviderStatusDemand = Effect.gen(function* () {
    const state = yield* Ref.get(snapshotStateRef);
    const instanceId = state.snapshot.instanceId;
    const [genericDemand, instanceDemand] = yield* Effect.all([
      backgroundPolicy.shouldRunScopeWork({ type: "provider-status" }),
      backgroundPolicy.shouldRunScopeWork({ type: "provider-status", instanceId }),
    ]);
    return genericDemand || instanceDemand;
  });

  const getRefreshInterval =
    input.refreshInterval !== undefined
      ? Effect.succeed(input.refreshInterval)
      : serverSettings.getSettings.pipe(
          Effect.map(
            (settings) =>
              resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
          ),
          Effect.orElseSucceed(() => DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL),
        );

  const refreshIntervalChanges = yield* Queue.sliding<void>(1);
  if (input.refreshInterval === undefined) {
    const serverSettingsChanges = yield* serverSettings.subscribeChanges;
    yield* serverSettingsChanges.pipe(
      Stream.map((settings) =>
        Duration.toMillis(
          resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
        ),
      ),
      Stream.changes,
      Stream.runForEach(() => Queue.offer(refreshIntervalChanges, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped,
    );
  }

  yield* Stream.runForEach(input.streamSettings, (nextSettings) =>
    Effect.asVoid(applySnapshot(nextSettings)),
  ).pipe(Effect.forkScoped);

  yield* Effect.forever(
    getRefreshInterval.pipe(
      Effect.flatMap((refreshInterval) =>
        Effect.raceFirst(
          Effect.sleep(
            Duration.toMillis(Duration.fromInputUnsafe(refreshInterval)) <= 0
              ? "60 seconds"
              : refreshInterval,
          ).pipe(Effect.as(true)),
          Queue.take(refreshIntervalChanges).pipe(Effect.as(false)),
        ).pipe(
          Effect.flatMap((intervalElapsed) =>
            input.refreshOnInterval !== false &&
            intervalElapsed &&
            Duration.toMillis(Duration.fromInputUnsafe(refreshInterval)) > 0
              ? hasProviderStatusDemand.pipe(
                  Effect.flatMap((shouldRefresh) =>
                    shouldRefresh ? refreshSnapshot().pipe(Effect.asVoid) : Effect.void,
                  ),
                )
              : Effect.void,
          ),
        ),
      ),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  yield* applySnapshot(initialSettings, { forceRefresh: true }).pipe(
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );

  return {
    resolveMaintenance: input.resolveMaintenance,
    getSnapshot: Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot)),
    refresh: refreshSnapshot().pipe(Effect.tapError(Effect.logError), Effect.orDie),
    applyUsageLimits,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ServerProviderShape;
});
