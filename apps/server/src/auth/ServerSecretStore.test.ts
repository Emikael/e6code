import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../config.ts";
import * as OsKeychain from "./OsKeychain.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const makeServerConfigLayer = () =>
  ServerConfig.layerTest(process.cwd(), { prefix: "e6-secret-store-test-" });

const makeServerSecretStoreLayer = () =>
  Layer.provide(ServerSecretStore.layer, makeServerConfigLayer());

const PermissionDeniedFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return {
      ...fileSystem,
      readFile: (path) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "readFile",
            pathOrDescriptor: path,
            description: "Permission denied while reading secret file.",
          }),
        ),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(NodeServices.layer));

const makePermissionDeniedSecretStoreLayer = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(makeServerConfigLayer()),
    Layer.provideMerge(PermissionDeniedFileSystemLayer),
  );

const RenameFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return {
      ...fileSystem,
      rename: (from, to) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "rename",
            pathOrDescriptor: `${String(from)} -> ${String(to)}`,
            description: "Permission denied while persisting secret file.",
          }),
        ),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(NodeServices.layer));

const makeRenameFailureSecretStoreLayer = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(makeServerConfigLayer()),
    Layer.provideMerge(RenameFailureFileSystemLayer),
  );

const RemoveFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return {
      ...fileSystem,
      remove: (path, options) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "remove",
            pathOrDescriptor: String(path),
            description: `Permission denied while removing secret file.${options ? " options-set" : ""}`,
          }),
        ),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(NodeServices.layer));

const makeRemoveFailureSecretStoreLayer = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(makeServerConfigLayer()),
    Layer.provideMerge(RemoveFailureFileSystemLayer),
  );

const ConcurrentReadMissFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const readCountRef = yield* Ref.make(0);
    const readBarrier = yield* Deferred.make<void>();

    return {
      ...fileSystem,
      readFile: (path) =>
        /[\\/]session-signing-key\.bin$/.test(String(path))
          ? Ref.updateAndGet(readCountRef, (count) => count + 1).pipe(
              Effect.flatMap((count) => {
                if (count > 2) {
                  return fileSystem.readFile(path);
                }
                return Effect.gen(function* () {
                  if (count === 2) {
                    yield* Deferred.succeed(readBarrier, void 0);
                  }
                  yield* Deferred.await(readBarrier);
                  return yield* Effect.failCause(
                    Cause.fail(
                      PlatformError.systemError({
                        _tag: "NotFound",
                        module: "FileSystem",
                        method: "readFile",
                        pathOrDescriptor: String(path),
                        description: "Secret file does not exist yet.",
                      }),
                    ),
                  );
                });
              }),
            )
          : fileSystem.readFile(path),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(NodeServices.layer));

const makeConcurrentCreateSecretStoreLayer = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(makeServerConfigLayer()),
    Layer.provideMerge(ConcurrentReadMissFileSystemLayer),
  );

it.layer(NodeServices.layer)("ServerSecretStore.layer", (it) => {
  it.effect("returns Option.none when a secret file does not exist", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const secret = yield* secretStore.get("missing-secret");

      assert.isTrue(Option.isNone(secret));
    }).pipe(Effect.provide(makeServerSecretStoreLayer())),
  );

  it.effect("reuses an existing secret instead of regenerating it", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const first = yield* secretStore.getOrCreateRandom("session-signing-key", 32);
      const second = yield* secretStore.getOrCreateRandom("session-signing-key", 32);

      assert.deepEqual(Array.from(second), Array.from(first));
    }).pipe(Effect.provide(makeServerSecretStoreLayer())),
  );

  it.effect("returns the persisted secret when concurrent creators race", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const [first, second] = yield* Effect.all(
        [
          secretStore.getOrCreateRandom("session-signing-key", 32),
          secretStore.getOrCreateRandom("session-signing-key", 32),
        ],
        { concurrency: "unbounded" },
      );
      const persisted = yield* secretStore.get("session-signing-key");
      const persistedBytes = Option.getOrThrow(persisted);

      assert.deepEqual(Array.from(first), Array.from(persistedBytes));
      assert.deepEqual(Array.from(second), Array.from(persistedBytes));
    }).pipe(Effect.provide(makeConcurrentCreateSecretStoreLayer())),
  );

  it.effect("uses restrictive permissions for the secret directory and files", () =>
    Effect.gen(function* () {
      const chmodCalls: Array<{ readonly path: string; readonly mode: number }> = [];
      const recordingFileSystemLayer = Layer.effect(
        FileSystem.FileSystem,
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;

          return {
            ...fileSystem,
            makeDirectory: () => Effect.void,
            writeFile: () => Effect.void,
            rename: () => Effect.void,
            chmod: (path, mode) =>
              Effect.sync(() => {
                chmodCalls.push({ path: String(path), mode });
              }),
          } satisfies FileSystem.FileSystem;
        }),
      ).pipe(Layer.provide(NodeServices.layer));

      const secretStore = yield* Effect.service(ServerSecretStore.ServerSecretStore).pipe(
        Effect.provide(
          ServerSecretStore.layer.pipe(
            Layer.provide(makeServerConfigLayer()),
            Layer.provideMerge(recordingFileSystemLayer),
          ),
        ),
      );

      yield* secretStore.set("session-signing-key", Uint8Array.from([1, 2, 3]));

      assert.isTrue(
        chmodCalls.some((call) => call.mode === 0o700 && /[\\/]secrets$/.test(call.path)),
      );
      assert.isAtLeast(chmodCalls.filter((call) => call.mode === 0o600).length, 2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("propagates read failures other than missing-file errors", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const error = yield* Effect.flip(secretStore.getOrCreateRandom("session-signing-key", 32));

      assert.instanceOf(error, ServerSecretStore.SecretStoreReadError);
      assert.include(error.message, "Failed to read secret session-signing-key.");
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.equal((error.cause as PlatformError.PlatformError).reason._tag, "PermissionDenied");
    }).pipe(Effect.provide(makePermissionDeniedSecretStoreLayer())),
  );

  it.effect("propagates write failures instead of treating them as success", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const error = yield* Effect.flip(
        secretStore.set("session-signing-key", Uint8Array.from([1, 2, 3])),
      );

      assert.instanceOf(error, ServerSecretStore.SecretStorePersistError);
      assert.include(error.message, "Failed to persist secret session-signing-key.");
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.equal((error.cause as PlatformError.PlatformError).reason._tag, "PermissionDenied");
    }).pipe(Effect.provide(makeRenameFailureSecretStoreLayer())),
  );

  it.effect("propagates remove failures other than missing-file errors", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const error = yield* Effect.flip(secretStore.remove("session-signing-key"));

      assert.instanceOf(error, ServerSecretStore.SecretStoreRemoveError);
      assert.include(error.message, "Failed to remove secret session-signing-key.");
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.equal((error.cause as PlatformError.PlatformError).reason._tag, "PermissionDenied");
    }).pipe(Effect.provide(makeRemoveFailureSecretStoreLayer())),
  );
});

describe("secret backend selection", () => {
  it("uses the file store under vitest unless the keychain is requested", () => {
    assert.equal(OsKeychain.selectSecretBackend({ vitest: "true" }), "file");
    assert.equal(OsKeychain.selectSecretBackend({ vitest: "true", secretStore: "file" }), "file");
    assert.equal(OsKeychain.selectSecretBackend({ secretStore: "file" }), "file");
    assert.equal(
      OsKeychain.selectSecretBackend({ vitest: "true", secretStore: "keychain" }),
      "probe",
    );
    assert.equal(OsKeychain.selectSecretBackend({}), "probe");
  });

  it.effect("logs the file fallback once and does not include a secret value", () =>
    Effect.gen(function* () {
      OsKeychain.resetOsKeychainFallbackLogForTests();
      const logs: Array<string> = [];
      const logger = Logger.make(({ message }) => {
        logs.push(String(message));
      });
      const warn = OsKeychain.logOsKeychainFileFallback.pipe(
        Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
      );
      yield* warn;
      yield* warn;
      assert.deepEqual(logs, [
        "OS keychain is unavailable. Provider secrets will stay in the local file store.",
      ]);
      assert.isFalse(logs.join("\n").includes("super-secret-value"));
    }),
  );
});

const freshKeychain = (): OsKeychain.KeychainDouble => ({
  entries: new Map(),
  failSet: false,
  corruptRead: false,
  failDelete: false,
});

const makeKeychainSecretStoreLayer = (state: OsKeychain.KeychainDouble) =>
  Layer.effect(ServerSecretStore.ServerSecretStore, ServerSecretStore.make).pipe(
    Layer.provide(OsKeychain.layerFromDouble(state)),
    Layer.provideMerge(makeServerConfigLayer()),
    Layer.provideMerge(NodeServices.layer),
  );

describe("OS keychain migration", () => {
  it.effect("moves a plaintext secret into the keychain and deletes the file", () => {
    const state = freshKeychain();
    return Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const secretPath = path.join(config.secretsDir, "provider-key.bin");
      yield* fileSystem.makeDirectory(config.secretsDir, { recursive: true });
      yield* fileSystem.writeFile(secretPath, Uint8Array.of(9, 8, 7));

      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const secret = yield* secretStore.get("provider-key");

      assert.deepEqual(Array.from(Option.getOrThrow(secret)), [9, 8, 7]);
      assert.deepEqual(Array.from(state.entries.get("provider-key") ?? []), [9, 8, 7]);
      assert.isFalse(yield* fileSystem.exists(secretPath));
    }).pipe(Effect.provide(makeKeychainSecretStoreLayer(state)));
  });

  it.effect("keeps the plaintext file when the keychain write fails", () => {
    const state = freshKeychain();
    state.failSet = true;
    return Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const secretPath = path.join(config.secretsDir, "provider-key.bin");
      yield* fileSystem.makeDirectory(config.secretsDir, { recursive: true });
      yield* fileSystem.writeFile(secretPath, Uint8Array.of(4, 5, 6));

      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const secret = yield* secretStore.get("provider-key");

      assert.deepEqual(Array.from(Option.getOrThrow(secret)), [4, 5, 6]);
      assert.isTrue(yield* fileSystem.exists(secretPath));
      assert.equal(state.entries.size, 0);
    }).pipe(Effect.provide(makeKeychainSecretStoreLayer(state)));
  });

  it.effect("keeps the plaintext file when the keychain read-back does not match", () => {
    const state = freshKeychain();
    state.corruptRead = true;
    return Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const secretPath = path.join(config.secretsDir, "provider-key.bin");
      yield* fileSystem.makeDirectory(config.secretsDir, { recursive: true });
      yield* fileSystem.writeFile(secretPath, Uint8Array.of(1, 2, 3));

      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const secret = yield* secretStore.get("provider-key");

      assert.deepEqual(Array.from(Option.getOrThrow(secret)), [1, 2, 3]);
      assert.isTrue(yield* fileSystem.exists(secretPath));
      assert.equal(state.entries.size, 0);
    }).pipe(Effect.provide(makeKeychainSecretStoreLayer(state)));
  });

  it.effect("does not leave a plaintext file after a verified keychain write", () => {
    const state = freshKeychain();
    return Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const secretPath = path.join(config.secretsDir, "provider-key.bin");
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      yield* secretStore.set("provider-key", Uint8Array.of(7, 7));

      assert.isFalse(yield* fileSystem.exists(secretPath));
      assert.deepEqual(Array.from(state.entries.get("provider-key") ?? []), [7, 7]);
      assert.deepEqual(
        Array.from(Option.getOrThrow(yield* secretStore.get("provider-key"))),
        [7, 7],
      );
      assert.isTrue(
        yield* fileSystem.exists(path.join(config.secretsDir, "provider-key.keychain")),
      );
    }).pipe(Effect.provide(makeKeychainSecretStoreLayer(state)));
  });
});

const never = () => new Promise<never>(() => {});

const makeProbedSecretStoreLayer = (options: OsKeychain.OpenKeychainLayerOptions) =>
  Layer.effect(ServerSecretStore.ServerSecretStore, ServerSecretStore.make).pipe(
    Layer.provideMerge(OsKeychain.openKeychainLayer(options)),
    Layer.provideMerge(makeServerConfigLayer()),
    Layer.provideMerge(NodeServices.layer),
  );

const withCapturedLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const logs: Array<string> = [];
    const logger = Logger.make(({ message }) => {
      logs.push(String(message));
    });
    const value = yield* effect.pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    );
    return { logs, value };
  });

describe("OS keychain availability", () => {
  it.live("falls back to the file store when the keychain probe times out", () =>
    Effect.gen(function* () {
      OsKeychain.resetOsKeychainFallbackLogForTests();
      const calls = { probe: 0, get: 0 };
      const secret = Uint8Array.of(3, 1, 4);
      const { logs } = yield* withCapturedLogs(
        Effect.gen(function* () {
          const keychain = yield* OsKeychain.OsKeychain;
          const secretStore = yield* ServerSecretStore.ServerSecretStore;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const config = yield* ServerConfig.ServerConfig;

          assert.equal(keychain.kind, "file");
          assert.isTrue(keychain.fallback);
          yield* secretStore.set("provider-key", secret);
          const read = yield* secretStore.get("provider-key");
          assert.deepEqual(Array.from(Option.getOrThrow(read)), [3, 1, 4]);
          assert.isTrue(yield* fileSystem.exists(path.join(config.secretsDir, "provider-key.bin")));
          assert.equal(calls.get, 0);
          assert.equal(calls.probe, 1);
        }).pipe(
          Effect.provide(
            makeProbedSecretStoreLayer({
              env: { secretStore: "keychain" },
              timeout: Duration.millis(30),
              port: {
                probe: () => {
                  calls.probe += 1;
                  return never();
                },
                get: () => {
                  calls.get += 1;
                  return never();
                },
                set: () => never(),
                delete: () => never(),
              },
            }),
          ),
        ),
      );

      assert.deepEqual(logs, [
        "OS keychain is unavailable. Provider secrets will stay in the local file store.",
      ]);
      assert.isFalse(logs.join("\n").includes("3,1,4"));
    }),
  );

  it.live("falls back to the file store when the native addon fails to load", () =>
    Effect.gen(function* () {
      OsKeychain.resetOsKeychainFallbackLogForTests();
      const { logs } = yield* withCapturedLogs(
        Effect.gen(function* () {
          const keychain = yield* OsKeychain.OsKeychain;
          const secretStore = yield* ServerSecretStore.ServerSecretStore;
          assert.equal(keychain.kind, "file");
          assert.isTrue(keychain.fallback);
          yield* secretStore.set("provider-key", Uint8Array.of(1));
          assert.deepEqual(
            Array.from(Option.getOrThrow(yield* secretStore.get("provider-key"))),
            [1],
          );
        }).pipe(
          Effect.provide(
            makeProbedSecretStoreLayer({
              env: { secretStore: "keychain" },
              load: () => {
                throw new Error("Failed to load native binding");
              },
            }),
          ),
        ),
      );

      assert.deepEqual(logs, [
        "OS keychain is unavailable. Provider secrets will stay in the local file store.",
      ]);
      assert.isFalse(logs.join("\n").includes("Failed to load native binding"));
    }),
  );

  it.live("stops calling the keychain after a secret read times out", () =>
    Effect.gen(function* () {
      OsKeychain.resetOsKeychainFallbackLogForTests();
      const calls = { get: 0 };
      yield* Effect.gen(function* () {
        const secretStore = yield* ServerSecretStore.ServerSecretStore;
        const first = yield* secretStore.get("provider-key");
        const second = yield* secretStore.get("provider-key");
        assert.isTrue(Option.isNone(first));
        assert.isTrue(Option.isNone(second));
        assert.equal(calls.get, 1);
      }).pipe(
        Effect.provide(
          makeProbedSecretStoreLayer({
            env: { secretStore: "keychain" },
            timeout: Duration.millis(30),
            port: {
              probe: async () => true,
              get: () => {
                calls.get += 1;
                return never();
              },
              set: async () => undefined,
              delete: async () => undefined,
            },
          }),
        ),
      );
    }),
  );

  it.live("fails a keychain-only secret instead of minting a replacement", () =>
    Effect.gen(function* () {
      OsKeychain.resetOsKeychainFallbackLogForTests();
      const error = yield* Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.makeDirectory(config.secretsDir, { recursive: true });
        const markerPath = path.join(config.secretsDir, "session-signing-key.keychain");
        yield* fileSystem.writeFile(markerPath, new Uint8Array());
        const secretStore = yield* ServerSecretStore.ServerSecretStore;
        return yield* Effect.flip(secretStore.getOrCreateRandom("session-signing-key", 32));
      }).pipe(
        Effect.provide(
          makeProbedSecretStoreLayer({
            env: { secretStore: "keychain" },
            timeout: Duration.millis(30),
            port: {
              probe: () => never(),
              get: () => never(),
              set: () => never(),
              delete: () => never(),
            },
          }),
        ),
      );

      assert.instanceOf(error, ServerSecretStore.SecretStoreReadError);
      assert.equal(error.message, "Failed to read provider secret from the OS keychain.");
      const cause = error.cause;
      assert.instanceOf(cause, Error);
      assert.include(
        (cause as Error).message,
        "The OS keychain is unavailable, so this provider cannot start.",
      );
      assert.isFalse(error.message.includes("session-signing-key"));
      assert.isFalse((cause as Error).message.includes("super-secret-value"));
    }),
  );
});
