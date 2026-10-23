import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as OsKeychain from "./OsKeychain.ts";

const secretStoreErrorContext = {
  resource: Schema.String,
  cause: Schema.Defect(),
};

export class SecretStoreSecureError extends Schema.TaggedError<SecretStoreSecureError>()(
  "SecretStoreSecureError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to secure ${this.resource}.`;
  }
}

export class SecretStoreReadError extends Schema.TaggedError<SecretStoreReadError>()(
  "SecretStoreReadError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource}.`;
  }
}

export class SecretStoreTemporaryPathError extends Schema.TaggedError<SecretStoreTemporaryPathError>()(
  "SecretStoreTemporaryPathError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to create temporary path for ${this.resource}.`;
  }
}

export class SecretStorePersistError extends Schema.TaggedError<SecretStorePersistError>()(
  "SecretStorePersistError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to persist ${this.resource}.`;
  }
}

export class SecretStoreRandomGenerationError extends Schema.TaggedError<SecretStoreRandomGenerationError>()(
  "SecretStoreRandomGenerationError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to generate random bytes for ${this.resource}.`;
  }
}

export class SecretStoreConcurrentReadError extends Schema.TaggedError<SecretStoreConcurrentReadError>()(
  "SecretStoreConcurrentReadError",
  {
    resource: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource} after concurrent creation.`;
  }
}

export class SecretStoreRemoveError extends Schema.TaggedError<SecretStoreRemoveError>()(
  "SecretStoreRemoveError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to remove ${this.resource}.`;
  }
}

export class SecretStoreDecodeError extends Schema.TaggedError<SecretStoreDecodeError>()(
  "SecretStoreDecodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to decode ${this.resource}.`;
  }
}

export class SecretStoreEncodeError extends Schema.TaggedError<SecretStoreEncodeError>()(
  "SecretStoreEncodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to encode ${this.resource}.`;
  }
}

export const SecretStoreError = Schema.Union([
  SecretStoreSecureError,
  SecretStoreReadError,
  SecretStoreTemporaryPathError,
  SecretStorePersistError,
  SecretStoreRandomGenerationError,
  SecretStoreConcurrentReadError,
  SecretStoreRemoveError,
  SecretStoreDecodeError,
  SecretStoreEncodeError,
]);
export type SecretStoreError = typeof SecretStoreError.Type;
export const isSecretStoreError = Schema.is(SecretStoreError);

const isPlatformError = (value: unknown): value is PlatformError.PlatformError =>
  Predicate.isTagged(value, "PlatformError");

export const isSecretAlreadyExistsError = (error: SecretStoreError): boolean =>
  "cause" in error && isPlatformError(error.cause) && error.cause.reason._tag === "AlreadyExists";

export class ServerSecretStore extends Context.Service<
  ServerSecretStore,
  {
    readonly get: (name: string) => Effect.Effect<Option.Option<Uint8Array>, SecretStoreError>;
    readonly set: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly create: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly getOrCreateRandom: (
      name: string,
      bytes: number,
    ) => Effect.Effect<Uint8Array, SecretStoreError>;
    readonly remove: (name: string) => Effect.Effect<void, SecretStoreError>;
  }
>()("e6/auth/ServerSecretStore") {}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
};

const secretAlreadyExists = (storageName: string) =>
  new SecretStorePersistError({
    resource: `secret ${storageName}`,
    cause: PlatformError.systemError({
      _tag: "AlreadyExists",
      module: "ServerSecretStore",
      method: "create",
      description: "Secret already exists.",
    }),
  });

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const keychain = yield* OsKeychain.OsKeychain;

  yield* fileSystem.makeDirectory(serverConfig.secretsDir, { recursive: true });
  yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe(
    Effect.mapError(
      (cause) =>
        new SecretStoreSecureError({
          resource: `secrets directory ${serverConfig.secretsDir}`,
          cause,
        }),
    ),
  );

  const resolveSecretPath = (storageName: string) =>
    path.join(serverConfig.secretsDir, `${storageName}.bin`);
  const keychainMarkerPath = (storageName: string) =>
    path.join(serverConfig.secretsDir, `${storageName}.keychain`);
  const preferFileMarkerPath = (storageName: string) =>
    path.join(serverConfig.secretsDir, `${storageName}.prefer-file`);

  const keychainOnlyError = () =>
    new SecretStoreReadError({
      resource: "provider secret from the OS keychain",
      cause: new Error(
        "The OS keychain is unavailable, so this provider cannot start. The secret value was not read.",
      ),
    });

  const markerExists = (markerPath: string) =>
    fileSystem.exists(markerPath).pipe(
      Effect.mapError(
        (cause) =>
          new SecretStoreReadError({
            resource: "secret marker",
            cause,
          }),
      ),
    );

  const writeEmptyMarker = (markerPath: string) =>
    fileSystem.writeFile(markerPath, new Uint8Array()).pipe(
      Effect.flatMap(() => fileSystem.chmod(markerPath, 0o600)),
      Effect.catch(() =>
        Effect.logWarning(
          "A secret marker could not be written. Provider startup depends on that marker when the OS keychain is down.",
        ),
      ),
    );

  const removeIfExists = (targetPath: string) => fileSystem.remove(targetPath).pipe(Effect.ignore);

  const requireStorageName = (name: string): Effect.Effect<string, SecretStorePersistError> => {
    const storageName = OsKeychain.secretStorageName(name);
    if (storageName === undefined) {
      return Effect.fail(
        new SecretStorePersistError({
          resource: "secret",
          cause: new Error("Secret name is empty or too long."),
        }),
      );
    }
    return Effect.succeed(storageName);
  };

  const readFileOption = (storageName: string) =>
    fileSystem.readFile(resolveSecretPath(storageName)).pipe(
      Effect.map((bytes) => Option.some(Uint8Array.from(bytes))),
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(Option.none())
          : Effect.fail(
              new SecretStoreReadError({
                resource: `secret ${storageName}`,
                cause,
              }),
            ),
      ),
    );

  const removePlaintext = (storageName: string) =>
    fileSystem.remove(resolveSecretPath(storageName)).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound" ? Effect.succeed(true) : Effect.succeed(false),
      ),
    );

  const writeFileSecret = (storageName: string, value: Uint8Array) => {
    const secretPath = resolveSecretPath(storageName);
    return crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new SecretStoreTemporaryPathError({
            resource: `secret ${storageName}`,
            cause,
          }),
      ),
      Effect.flatMap((uuid) => {
        const tempPath = `${secretPath}.${uuid}.tmp`;
        return Effect.gen(function* () {
          yield* fileSystem.writeFile(tempPath, value);
          yield* fileSystem.chmod(tempPath, 0o600);
          yield* fileSystem.rename(tempPath, secretPath);
          yield* fileSystem.chmod(secretPath, 0o600);
        }).pipe(
          Effect.catch((cause) =>
            fileSystem.remove(tempPath).pipe(
              Effect.ignore,
              Effect.flatMap(() =>
                Effect.fail(
                  new SecretStorePersistError({
                    resource: `secret ${storageName}`,
                    cause,
                  }),
                ),
              ),
            ),
          ),
        );
      }),
    );
  };

  type KeychainRead =
    | { readonly _tag: "Ok"; readonly value: Option.Option<Uint8Array> }
    | { readonly _tag: "Unavailable" };

  const readKeychain = (storageName: string): Effect.Effect<KeychainRead, SecretStoreReadError> =>
    keychain.get(storageName).pipe(
      Effect.map((value): KeychainRead => ({ _tag: "Ok", value })),
      Effect.catchTag(
        "KeychainError",
        (cause): Effect.Effect<KeychainRead, SecretStoreReadError> => {
          if (OsKeychain.isKeychainUnavailable(cause)) {
            return Effect.succeed({ _tag: "Unavailable" });
          }
          return Effect.fail(
            new SecretStoreReadError({
              resource: `secret ${storageName}`,
              cause,
            }),
          );
        },
      ),
    );

  const writeKeychainVerified = (storageName: string, value: Uint8Array) =>
    Effect.gen(function* () {
      const wrote = yield* keychain.set(storageName, value).pipe(
        Effect.as("ok" as const),
        Effect.catchTag("KeychainError", (cause): Effect.Effect<"ok" | "unavailable" | "failed"> =>
          Effect.succeed(OsKeychain.isKeychainUnavailable(cause) ? "unavailable" : "failed"),
        ),
      );
      if (wrote === "unavailable") {
        return "unavailable" as const;
      }
      if (wrote === "failed") {
        yield* Effect.logWarning(
          "Failed to write a secret to the OS keychain. The plaintext file was left in place.",
        );
        return "failed" as const;
      }
      const readBack = yield* keychain
        .get(storageName)
        .pipe(
          Effect.catchTag(
            "KeychainError",
            (cause): Effect.Effect<"unavailable" | Option.Option<Uint8Array>> =>
              Effect.succeed(
                OsKeychain.isKeychainUnavailable(cause) ? "unavailable" : Option.none<Uint8Array>(),
              ),
          ),
        );
      if (readBack === "unavailable") {
        return "unavailable" as const;
      }
      if (Option.isNone(readBack) || !bytesEqual(readBack.value, value)) {
        yield* keychain.delete(storageName).pipe(Effect.ignore);
        yield* Effect.logWarning(
          "OS keychain read-back did not match the secret. The plaintext file was left in place.",
        );
        return "failed" as const;
      }
      return "verified" as const;
    });

  const readFileOrKeychainOnly = (storageName: string) =>
    Effect.gen(function* () {
      const fileBytes = yield* readFileOption(storageName);
      if (Option.isSome(fileBytes)) {
        return fileBytes;
      }
      if (yield* markerExists(keychainMarkerPath(storageName))) {
        return yield* keychainOnlyError();
      }
      return Option.none<Uint8Array>();
    });

  const rememberFileIsNewer = (storageName: string) =>
    Effect.gen(function* () {
      yield* removeIfExists(keychainMarkerPath(storageName));
      yield* writeEmptyMarker(preferFileMarkerPath(storageName));
    });

  const rememberKeychainHoldsSecret = (storageName: string) =>
    Effect.gen(function* () {
      yield* writeEmptyMarker(keychainMarkerPath(storageName));
      yield* removeIfExists(preferFileMarkerPath(storageName));
      const removed = yield* removePlaintext(storageName);
      if (!removed) {
        yield* Effect.logWarning(
          "OS keychain holds the secret, but the plaintext file could not be removed.",
        );
      }
    });

  const adoptPreferredFile = (storageName: string) =>
    Effect.gen(function* () {
      if (!(yield* markerExists(preferFileMarkerPath(storageName)))) {
        return Option.none<Uint8Array>();
      }
      const fileBytes = yield* readFileOption(storageName);
      if (Option.isNone(fileBytes)) {
        return Option.none<Uint8Array>();
      }
      const migrated = yield* writeKeychainVerified(storageName, fileBytes.value);
      if (migrated !== "verified") {
        return fileBytes;
      }
      yield* rememberKeychainHoldsSecret(storageName);
      return fileBytes;
    });

  const get: ServerSecretStore["Service"]["get"] = (name) =>
    Effect.gen(function* () {
      const storageName = yield* requireStorageName(name);
      if (keychain.kind === "file") {
        return yield* readFileOrKeychainOnly(storageName);
      }
      const preferred = yield* adoptPreferredFile(storageName);
      if (Option.isSome(preferred)) {
        return preferred;
      }
      const stored = yield* readKeychain(storageName);
      if (stored._tag === "Unavailable") {
        return yield* readFileOrKeychainOnly(storageName);
      }
      if (Option.isSome(stored.value)) {
        yield* rememberKeychainHoldsSecret(storageName);
        return stored.value;
      }
      const fileBytes = yield* readFileOption(storageName);
      if (Option.isNone(fileBytes)) {
        if (yield* markerExists(keychainMarkerPath(storageName))) {
          return yield* keychainOnlyError();
        }
        return Option.none();
      }
      const migrated = yield* writeKeychainVerified(storageName, fileBytes.value);
      if (migrated === "unavailable") {
        return fileBytes;
      }
      if (migrated === "failed") {
        return fileBytes;
      }
      yield* rememberKeychainHoldsSecret(storageName);
      return fileBytes;
    }).pipe(Effect.withSpan("ServerSecretStore.get"));

  const set: ServerSecretStore["Service"]["set"] = (name, value) =>
    Effect.gen(function* () {
      const storageName = yield* requireStorageName(name);
      if (keychain.kind === "file") {
        yield* writeFileSecret(storageName, value);
        if (keychain.fallback) {
          yield* rememberFileIsNewer(storageName);
        }
        return;
      }
      const migrated = yield* writeKeychainVerified(storageName, value);
      if (migrated === "unavailable") {
        yield* writeFileSecret(storageName, value);
        yield* rememberFileIsNewer(storageName);
        return;
      }
      if (migrated === "failed") {
        return yield* new SecretStorePersistError({
          resource: `secret ${storageName}`,
          cause: new Error("OS keychain write was not verified."),
        });
      }
      yield* rememberKeychainHoldsSecret(storageName);
    }).pipe(Effect.withSpan("ServerSecretStore.set"));

  const createFile = (storageName: string, value: Uint8Array) => {
    const secretPath = resolveSecretPath(storageName);
    return Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(secretPath, {
          flag: "wx",
          mode: 0o600,
        });
        yield* file.writeAll(value);
        yield* file.sync;
        yield* fileSystem.chmod(secretPath, 0o600);
      }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SecretStorePersistError({
            resource: `secret ${storageName}`,
            cause,
          }),
      ),
    );
  };

  const create: ServerSecretStore["Service"]["create"] = (name, value) => {
    const storageName = OsKeychain.secretStorageName(name);
    if (storageName === undefined) {
      return Effect.fail(
        new SecretStorePersistError({
          resource: "secret",
          cause: new Error("Secret name is empty or too long."),
        }),
      );
    }
    if (keychain.kind === "file") {
      return Effect.gen(function* () {
        if (yield* markerExists(keychainMarkerPath(storageName))) {
          return yield* keychainOnlyError();
        }
        yield* createFile(storageName, value);
        if (keychain.fallback) {
          yield* rememberFileIsNewer(storageName);
        }
      });
    }
    return Effect.gen(function* () {
      const existing = yield* readKeychain(storageName);
      if (existing._tag === "Unavailable") {
        if (yield* markerExists(keychainMarkerPath(storageName))) {
          return yield* keychainOnlyError();
        }
        const fileBytes = yield* readFileOption(storageName);
        if (Option.isSome(fileBytes)) {
          return yield* secretAlreadyExists(storageName);
        }
        yield* createFile(storageName, value);
        yield* rememberFileIsNewer(storageName);
        return;
      }
      if (Option.isSome(existing.value)) {
        return yield* secretAlreadyExists(storageName);
      }
      const fileBytes = yield* readFileOption(storageName);
      if (Option.isSome(fileBytes)) {
        return yield* secretAlreadyExists(storageName);
      }
      if (yield* markerExists(keychainMarkerPath(storageName))) {
        return yield* secretAlreadyExists(storageName);
      }
      const migrated = yield* writeKeychainVerified(storageName, value);
      if (migrated === "unavailable") {
        yield* createFile(storageName, value);
        yield* rememberFileIsNewer(storageName);
        return;
      }
      if (migrated !== "verified") {
        return yield* new SecretStorePersistError({
          resource: `secret ${storageName}`,
          cause: new Error("OS keychain write was not verified."),
        });
      }
      yield* rememberKeychainHoldsSecret(storageName);
    });
  };

  const getOrCreateRandom: ServerSecretStore["Service"]["getOrCreateRandom"] = (name, bytes) =>
    get(name).pipe(
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            crypto.randomBytes(bytes).pipe(
              Effect.mapError(
                (cause) =>
                  new SecretStoreRandomGenerationError({
                    resource: `secret ${name}`,
                    cause,
                  }),
              ),
              Effect.flatMap((generated) =>
                create(name, generated).pipe(
                  Effect.as(Uint8Array.from(generated)),
                  Effect.catchIf(isSecretStoreError, (error) =>
                    isSecretAlreadyExistsError(error)
                      ? get(name).pipe(
                          Effect.flatMap(
                            Option.match({
                              onSome: Effect.succeed,
                              onNone: () =>
                                Effect.fail(
                                  new SecretStoreConcurrentReadError({
                                    resource: `secret ${name}`,
                                  }),
                                ),
                            }),
                          ),
                        )
                      : Effect.fail(error),
                  ),
                ),
              ),
            ),
        }),
      ),
      Effect.withSpan("ServerSecretStore.getOrCreateRandom"),
    );

  const remove: ServerSecretStore["Service"]["remove"] = (name) =>
    Effect.gen(function* () {
      const storageName = yield* requireStorageName(name).pipe(
        Effect.mapError(
          (cause) =>
            new SecretStoreRemoveError({
              resource: "secret",
              cause,
            }),
        ),
      );
      if (keychain.kind === "keychain") {
        const deleted = yield* keychain.delete(storageName).pipe(
          Effect.as("ok" as const),
          Effect.catchTag(
            "KeychainError",
            (cause): Effect.Effect<"ok" | "unavailable", SecretStoreRemoveError> => {
              if (OsKeychain.isKeychainUnavailable(cause)) {
                return Effect.succeed("unavailable");
              }
              return Effect.fail(
                new SecretStoreRemoveError({
                  resource: `secret ${storageName}`,
                  cause,
                }),
              );
            },
          ),
        );
        if (deleted === "unavailable") {
          return yield* new SecretStoreRemoveError({
            resource: "provider secret from the OS keychain",
            cause: new Error(
              "The OS keychain is unavailable, so this secret could not be removed.",
            ),
          });
        }
      }
      yield* fileSystem.remove(resolveSecretPath(storageName)).pipe(
        Effect.catch((cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.void
            : Effect.fail(
                new SecretStoreRemoveError({
                  resource: `secret ${storageName}`,
                  cause,
                }),
              ),
        ),
      );
      yield* removeIfExists(keychainMarkerPath(storageName));
      yield* removeIfExists(preferFileMarkerPath(storageName));
    }).pipe(Effect.withSpan("ServerSecretStore.remove"));

  return ServerSecretStore.of({
    get,
    set,
    create,
    getOrCreateRandom,
    remove,
  });
});

export const layer = Layer.effect(ServerSecretStore, make).pipe(Layer.provide(OsKeychain.layer));
