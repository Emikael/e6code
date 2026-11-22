import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind } from "@e6tools/contracts";
import { encodeRecording } from "@e6tools/shared/testing/providerReplay/recording";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { ProviderInstanceRegistryHydrationLive } from "../Layers/ProviderInstanceRegistryHydration.ts";
import type { AnyProviderDriver } from "../ProviderDriver.ts";
import { contractRecording } from "../testUtils/replayRecordings.ts";
import {
  loadReplayDrivers,
  replayDriversConfig,
  resolveProviderInstanceRegistryHydration,
  withReplayDrivers,
} from "./replayDrivers.ts";

const cursor = ProviderDriverKind.make("cursor");
const codex = ProviderDriverKind.make("codex");

const fakeDriver = (kind: string): AnyProviderDriver => ({
  driverKind: ProviderDriverKind.make(kind),
  metadata: { displayName: kind },
  configSchema: Schema.Struct({ enabled: Schema.Boolean }),
  defaultConfig: () => ({ enabled: true }),
  create: () => Effect.die(`the ${kind} driver must not be created here`),
});

const withEnv = (env: Record<string, string>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

/** Writes recordings into a scoped temp directory and returns their absolute paths. */
const writeRecordings = Effect.fnUntraced(function* (
  files: ReadonlyArray<readonly [name: string, text: string]>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped();
  const paths: Array<string> = [];
  for (const [name, text] of files) {
    const filePath = path.join(directory, name);
    yield* fileSystem.writeFileString(filePath, text);
    paths.push(filePath);
  }
  return paths;
});

describe("replayDrivers", () => {
  it.effect("leaves the hydration layer untouched when replay is unset or blank", () =>
    Effect.gen(function* () {
      expect(yield* resolveProviderInstanceRegistryHydration.pipe(withEnv({}))).toBe(
        ProviderInstanceRegistryHydrationLive,
      );
      expect(
        yield* resolveProviderInstanceRegistryHydration.pipe(
          withEnv({ E6CODE_PROVIDER_REPLAY: "  " }),
        ),
      ).toBe(ProviderInstanceRegistryHydrationLive);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("substitutes the recorded kind and keeps every other driver", () =>
    Effect.gen(function* () {
      const base = [fakeDriver("codex"), fakeDriver("cursor"), fakeDriver("grok")];
      const drivers = yield* withReplayDrivers(base, [contractRecording(cursor, "plain")], {
        speed: "instant",
      });

      expect(drivers.map((driver) => driver.driverKind)).toEqual(["codex", "cursor", "grok"]);
      expect(drivers[0]).toBe(base[0]);
      expect(drivers[2]).toBe(base[2]);
      const replay = drivers[1]!;
      expect(replay).not.toBe(base[1]);
      // The legacy settings blob for the replaced kind still decodes.
      expect(replay.metadata).toEqual(base[1]!.metadata);
      const decodeReplayConfig = Schema.decodeUnknownEffect(replay.configSchema);
      expect(yield* decodeReplayConfig({ enabled: false })).toEqual({ enabled: false });
      expect(replay.defaultConfig()).toEqual({ enabled: true });
    }),
  );

  it.effect("rejects a recording whose provider has no built-in driver", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        withReplayDrivers(
          [fakeDriver("codex")],
          [contractRecording(ProviderDriverKind.make("mystery"), "plain")],
          {},
        ),
      );
      expect(error._tag).toBe("ProviderReplayConfigError");
      expect(error.message).toContain("mystery");
    }),
  );

  it.effect("rejects two recordings for one kind", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        withReplayDrivers(
          [fakeDriver("codex")],
          [contractRecording(codex, "plain"), contractRecording(codex, "approval")],
          {},
        ),
      );
      expect(error.message).toContain("codex");
    }),
  );

  it.effect("reads recordings named by the environment and substitutes their kinds", () =>
    Effect.gen(function* () {
      const [codexPath, cursorPath] = yield* writeRecordings([
        ["codex.ndjson", encodeRecording(contractRecording(codex, "plain"))],
        ["cursor.ndjson", encodeRecording(contractRecording(cursor, "approval"))],
      ]);
      const loaded = yield* loadReplayDrivers.pipe(
        withEnv({ E6CODE_PROVIDER_REPLAY: `${codexPath}, ${cursorPath}` }),
      );
      const drivers = Option.getOrThrow(loaded);

      expect(drivers.map((driver) => driver.driverKind)).toEqual(
        BUILT_IN_DRIVERS.map((driver) => driver.driverKind),
      );
      for (const [index, driver] of drivers.entries()) {
        const replayed = driver.driverKind === codex || driver.driverKind === cursor;
        expect(driver === BUILT_IN_DRIVERS[index]).toBe(!replayed);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails loudly on a corrupt recording, a missing file or a relative path", () =>
    Effect.gen(function* () {
      const [corruptPath] = yield* writeRecordings([
        [
          "corrupt.ndjson",
          `${encodeRecording(contractRecording(codex, "plain"))}{"kind":"event","dt":-1}\n`,
        ],
      ]);
      const corrupt = yield* Effect.flip(
        loadReplayDrivers.pipe(withEnv({ E6CODE_PROVIDER_REPLAY: corruptPath! })),
      );
      expect(corrupt._tag).toBe("ProviderReplayConfigError");
      expect(corrupt.message).toContain(corruptPath!);
      expect(corrupt.message).toContain("line");

      const missing = yield* Effect.flip(
        loadReplayDrivers.pipe(withEnv({ E6CODE_PROVIDER_REPLAY: `${corruptPath}.missing` })),
      );
      expect(missing.message).toContain(`${corruptPath}.missing`);

      const relative = yield* Effect.flip(
        loadReplayDrivers.pipe(withEnv({ E6CODE_PROVIDER_REPLAY: "recordings/codex.ndjson" })),
      );
      expect(relative.message).toContain("absolute");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("decodes playback options with harness defaults", () =>
    Effect.gen(function* () {
      const defaults = yield* replayDriversConfig.pipe(withEnv({ E6CODE_PROVIDER_REPLAY: "/r" }));
      expect(defaults).toEqual({
        paths: ["/r"],
        options: { speed: 1, onExhausted: "loop", autoRespond: true },
      });

      const tuned = yield* replayDriversConfig.pipe(
        withEnv({
          E6CODE_PROVIDER_REPLAY: "/a,/b",
          E6CODE_PROVIDER_REPLAY_SPEED: "7",
          E6CODE_PROVIDER_REPLAY_EVENTS_PER_SECOND: "50",
          E6CODE_PROVIDER_REPLAY_MAX_GAP_MS: "500",
          E6CODE_PROVIDER_REPLAY_ON_EXHAUSTED: "fail",
          E6CODE_PROVIDER_REPLAY_AUTO_RESPOND: "false",
        }),
      );
      expect(tuned).toEqual({
        paths: ["/a", "/b"],
        options: {
          speed: 7,
          eventsPerSecond: 50,
          maxGapMs: 500,
          onExhausted: "fail",
          autoRespond: false,
        },
      });

      const instant = yield* replayDriversConfig.pipe(
        withEnv({ E6CODE_PROVIDER_REPLAY: "/r", E6CODE_PROVIDER_REPLAY_SPEED: "instant" }),
      );
      expect(instant.options.speed).toBe("instant");

      for (const [name, value] of [
        ["E6CODE_PROVIDER_REPLAY_SPEED", "fast"],
        ["E6CODE_PROVIDER_REPLAY_SPEED", "0"],
        ["E6CODE_PROVIDER_REPLAY_EVENTS_PER_SECOND", "-5"],
        ["E6CODE_PROVIDER_REPLAY_ON_EXHAUSTED", "stop"],
      ] as const) {
        const result = yield* Effect.exit(
          replayDriversConfig.pipe(withEnv({ E6CODE_PROVIDER_REPLAY: "/r", [name]: value })),
        );
        expect(result._tag, `${name}=${value}`).toBe("Failure");
      }
    }),
  );
});
