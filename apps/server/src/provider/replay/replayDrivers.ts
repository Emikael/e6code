/**
 * Provider replay boot seam: when `E6CODE_PROVIDER_REPLAY` names recordings,
 * the server builds each recorded provider kind with a `ReplayProviderDriver`
 * instead of its real driver, so a whole server runs against recorded provider
 * traffic without any provider CLI. The web performance harness uses it.
 *
 *   E6CODE_PROVIDER_REPLAY                   comma-separated absolute recording paths
 *   E6CODE_PROVIDER_REPLAY_SPEED             playback multiplier or "instant" (default 1)
 *   E6CODE_PROVIDER_REPLAY_EVENTS_PER_SECOND steady event rate within a segment
 *   E6CODE_PROVIDER_REPLAY_MAX_GAP_MS        caps any single recorded gap
 *   E6CODE_PROVIDER_REPLAY_ON_EXHAUSTED      "loop" (default) or "fail"
 *   E6CODE_PROVIDER_REPLAY_AUTO_RESPOND      answer recorded approvals (default true)
 *
 * Unset (or blank), the server gets `ProviderInstanceRegistryHydrationLive`
 * itself. Set, a recording that cannot be read or decoded, a kind with no
 * built-in driver, or two recordings for one kind fail server start: an
 * explicit opt-in never falls back to real providers.
 *
 * @module provider/replay/replayDrivers
 */
import { withLegacyBrandEnv } from "@e6tools/shared/brand";
import {
  decodeRecording,
  type ProviderReplayRecording,
} from "@e6tools/shared/testing/providerReplay/recording";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import {
  makeProviderInstanceRegistryHydration,
  ProviderInstanceRegistryHydrationLive,
} from "../Layers/ProviderInstanceRegistryHydration.ts";
import type { AnyProviderDriver } from "../ProviderDriver.ts";
import { makeReplayProviderDriver, type ReplayDriverOptions } from "./ReplayProviderDriver.ts";

class ProviderReplayConfigError extends Schema.TaggedError<ProviderReplayConfigError>()(
  "ProviderReplayConfigError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `Provider replay is misconfigured: ${this.detail}`;
  }
}

const PositiveFinite = Schema.Finite.check(Schema.isGreaterThan(0));
const NonNegativeFinite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

const optional = <A>(suffix: string, schema: Schema.ConstraintCodec<A, unknown>) =>
  withLegacyBrandEnv(suffix, (name) => Config.schema(schema, name)).pipe(Config.option);

/** The replay switches, read from the environment; `paths` is empty when replay is off. */
export const replayDriversConfig = Config.all({
  paths: withLegacyBrandEnv("PROVIDER_REPLAY", Config.String).pipe(
    Config.withDefault(""),
    Config.map((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ),
  speed: withLegacyBrandEnv("PROVIDER_REPLAY_SPEED", (name) =>
    Config.schema(Schema.Union([Schema.Literal("instant"), PositiveFinite]), name),
  ).pipe(Config.withDefault(1)),
  eventsPerSecond: optional("PROVIDER_REPLAY_EVENTS_PER_SECOND", PositiveFinite),
  maxGapMs: optional("PROVIDER_REPLAY_MAX_GAP_MS", NonNegativeFinite),
  onExhausted: withLegacyBrandEnv("PROVIDER_REPLAY_ON_EXHAUSTED", (name) =>
    Config.Literals(["loop", "fail"], name),
  ).pipe(Config.withDefault("loop")),
  autoRespond: withLegacyBrandEnv("PROVIDER_REPLAY_AUTO_RESPOND", Config.Boolean).pipe(
    Config.withDefault(true),
  ),
}).pipe(
  Config.map(({ paths, speed, eventsPerSecond, maxGapMs, onExhausted, autoRespond }) => ({
    paths,
    options: {
      speed,
      ...Option.match(eventsPerSecond, {
        onNone: () => ({}),
        onSome: (value) => ({ eventsPerSecond: value }),
      }),
      ...Option.match(maxGapMs, { onNone: () => ({}), onSome: (value) => ({ maxGapMs: value }) }),
      onExhausted,
      autoRespond,
    } satisfies ReplayDriverOptions,
  })),
);

/** Replaces each recorded kind's driver in `base` with a replay driver of that kind. */
export const withReplayDrivers = Effect.fnUntraced(function* <R>(
  base: ReadonlyArray<AnyProviderDriver<R>>,
  recordings: ReadonlyArray<ProviderReplayRecording>,
  options: ReplayDriverOptions,
) {
  const byKind = new Map<string, ProviderReplayRecording>();
  for (const recording of recordings) {
    const kind = recording.header.provider;
    const previous = byKind.get(kind);
    if (previous !== undefined) {
      return yield* new ProviderReplayConfigError({
        detail: `recordings '${previous.header.id}' and '${recording.header.id}' both replay '${kind}'`,
      });
    }
    if (!base.some((driver) => driver.driverKind === kind)) {
      return yield* new ProviderReplayConfigError({
        detail: `recording '${recording.header.id}' replays '${kind}', which has no built-in driver`,
      });
    }
    byKind.set(kind, recording);
  }
  return base.map((driver): AnyProviderDriver<R> => {
    const recording = byKind.get(driver.driverKind);
    return recording === undefined
      ? driver
      : makeReplayProviderDriver({ driver, recording, options });
  });
});

const readRecording = Effect.fnUntraced(function* (filePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!path.isAbsolute(filePath)) {
    return yield* new ProviderReplayConfigError({
      detail: `recording path '${filePath}' must be absolute`,
    });
  }
  const text = yield* fileSystem.readFileString(filePath).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderReplayConfigError({
          detail: `cannot read recording '${filePath}': ${cause.message}`,
        }),
    ),
  );
  return yield* decodeRecording(text).pipe(
    Effect.mapError(
      (cause) => new ProviderReplayConfigError({ detail: `'${filePath}': ${cause.message}` }),
    ),
  );
});

/** The built-in drivers with recorded kinds replayed, or none when replay is off. */
export const loadReplayDrivers = Effect.gen(function* () {
  const { paths, options } = yield* replayDriversConfig.pipe(
    Effect.mapError((cause) => new ProviderReplayConfigError({ detail: cause.message })),
  );
  if (paths.length === 0) return Option.none();
  const recordings = yield* Effect.forEach(paths, readRecording);
  const drivers = yield* withReplayDrivers(BUILT_IN_DRIVERS, recordings, options);
  for (const recording of recordings) {
    yield* Effect.logInfo(
      `provider replay active: ${recording.header.provider} ← ${recording.header.id}`,
    );
  }
  return Option.some(drivers);
});

/** The registry hydration layer for this process: replayed when the environment asks for it. */
export const resolveProviderInstanceRegistryHydration = loadReplayDrivers.pipe(
  Effect.map(
    Option.match({
      onNone: () => ProviderInstanceRegistryHydrationLive,
      onSome: (drivers) => makeProviderInstanceRegistryHydration(drivers),
    }),
  ),
);

export const ProviderInstanceRegistryHydrationWithReplayLive = Layer.unwrap(
  resolveProviderInstanceRegistryHydration,
);
