// @effect-diagnostics nodeBuiltinImport:off - createRequire loads the external native addon from disk, including inside the CLI bundle.
import * as NodeModule from "node:module";

import type { AsyncEntry as KeyringAsyncEntry } from "@napi-rs/keyring";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

export class KeychainError extends Schema.TaggedError<KeychainError>()("KeychainError", {
  operation: Schema.Literals(["get", "set", "delete", "probe"]),
  reason: Schema.Literals(["timeout", "load", "failed"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `OS keychain ${this.operation} failed.`;
  }
}

const keychainFailure = (
  operation: "get" | "set" | "delete" | "probe",
  reason: "timeout" | "load" | "failed",
  cause: unknown,
) => new KeychainError({ operation, reason, cause });

/**
 * OS credential store for provider secrets.
 *
 * The desktop app spawns `bin.mjs` as its own Node process, and `e6 serve` has
 * no Electron process at all, so Electron `safeStorage` is not available here.
 * `@napi-rs/keyring` (MIT, napi-rs prebuilds) talks to the macOS Keychain,
 * Windows Credential Manager, and Linux Secret Service from this process. The
 * desktop app already depends on the same package for Chromium cookie import.
 *
 * The sync `Entry` API blocks the Node thread inside the native call, so a
 * Keychain prompt or a stuck Secret Service D-Bus call would freeze startup.
 * `AsyncEntry` runs on the libuv pool and accepts an `AbortSignal`. Each call
 * is raced against {@link KEYCHAIN_OPERATION_TIMEOUT}. On timeout the promise
 * is abandoned and this process uses the file store.
 */
const KEYCHAIN_SERVICE = "com.e6code.secrets";
const PROBE_ACCOUNT = "e6-keychain-probe";
const SAFE_SECRET_NAME = /^[A-Za-z0-9_-]{1,200}$/;
const KEYCHAIN_OPERATION_TIMEOUT = Duration.seconds(3);

const requireKeyring = NodeModule.createRequire(import.meta.url);

export class OsKeychain extends Context.Service<
  OsKeychain,
  {
    readonly kind: "file" | "keychain";
    /**
     * True when this process wanted the OS keychain and fell back to files.
     * A forced file store (`E6CODE_SECRET_STORE=file`, or vitest) stays false.
     */
    readonly fallback: boolean;
    readonly get: (account: string) => Effect.Effect<Option.Option<Uint8Array>, KeychainError>;
    readonly set: (account: string, value: Uint8Array) => Effect.Effect<void, KeychainError>;
    readonly delete: (account: string) => Effect.Effect<void, KeychainError>;
  }
>()("e6/auth/OsKeychain") {}

/** Existing safe names stay unchanged so current `secrets/<name>.bin` files still migrate. */
export function secretStorageName(name: string): string | undefined {
  if (SAFE_SECRET_NAME.test(name)) {
    return name;
  }
  if (name.length === 0 || name.length > 1024) {
    return undefined;
  }
  return `enc-${Buffer.from(name, "utf8").toString("base64url")}`;
}

export type SecretBackendChoice = "file" | "probe";

export function selectSecretBackend(env: {
  readonly vitest?: string | undefined;
  readonly secretStore?: string | undefined;
}): SecretBackendChoice {
  if (env.secretStore === "file") {
    return "file";
  }
  if (env.vitest === "true" && env.secretStore !== "keychain") {
    return "file";
  }
  return "probe";
}

export interface KeychainDouble {
  readonly entries: Map<string, Uint8Array>;
  failSet: boolean;
  corruptRead: boolean;
  failDelete: boolean;
}

/**
 * Test and startup stand-in for the native addon. `probe` reports whether the
 * store can round-trip a byte. Missing entries resolve to `undefined`.
 */
export interface KeychainPort {
  readonly probe: (signal: AbortSignal) => Promise<boolean>;
  readonly get: (account: string, signal: AbortSignal) => Promise<Uint8Array | undefined>;
  readonly set: (account: string, value: Uint8Array, signal: AbortSignal) => Promise<void>;
  readonly delete: (account: string, signal: AbortSignal) => Promise<void>;
}

export interface OpenKeychainLayerOptions {
  readonly env?: {
    readonly vitest?: string | undefined;
    readonly secretStore?: string | undefined;
  };
  readonly load?: () => KeychainPort;
  readonly port?: KeychainPort;
  readonly timeout?: Duration.Duration;
}

const unavailable = Effect.die("File secret backend does not read the OS keychain.");

const makeFileService = (fallback: boolean): OsKeychain["Service"] =>
  OsKeychain.of({
    kind: "file",
    fallback,
    get: () => unavailable,
    set: () => unavailable,
    delete: () => unavailable,
  });

const fileLayer = (fallback: boolean) => Layer.succeed(OsKeychain, makeFileService(fallback));

export const isKeychainUnavailable = (error: KeychainError): boolean =>
  error.reason === "timeout" || error.reason === "load";

function isMissingEntry(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }
  const record = cause as { readonly message?: unknown; readonly code?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  const code = typeof record.code === "string" ? record.code : "";
  return message.includes("NoEntry") || code.includes("NoEntry");
}

function isNativeLoadFailure(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }
  const message =
    "message" in cause && typeof cause.message === "string" ? cause.message : String(cause);
  return (
    message.includes("Failed to load native binding") ||
    message.includes("Cannot find module") ||
    message.includes("ERR_DLOPEN_FAILED") ||
    message.includes("OS keychain native binding is missing")
  );
}

function failureReason(cause: unknown): "load" | "failed" {
  return isNativeLoadFailure(cause) ? "load" : "failed";
}

/**
 * Attach a handler before returning so a rejection after the timeout is not
 * an unhandledRejection. The caller still observes the original promise.
 */
function guardLateRejection<A>(run: (signal: AbortSignal) => Promise<A>) {
  return (signal: AbortSignal): Promise<A> => {
    const promise = Promise.resolve().then(() => run(signal));
    void promise.then(
      () => undefined,
      () => undefined,
    );
    return promise;
  };
}

function bounded<A>(
  operation: "get" | "set" | "delete" | "probe",
  timeout: Duration.Duration,
  run: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, KeychainError> {
  return Effect.tryPromise({
    try: guardLateRejection(run),
    catch: (cause) => keychainFailure(operation, failureReason(cause), cause),
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          keychainFailure(operation, "timeout", new Error("OS keychain operation timed out.")),
        ),
    }),
  );
}

function portFromAsyncEntry(
  AsyncEntry: new (service: string, username: string) => KeyringAsyncEntry,
): KeychainPort {
  const entry = (account: string) => new AsyncEntry(KEYCHAIN_SERVICE, account);
  return {
    probe: async (signal) => {
      const probeEntry = entry(PROBE_ACCOUNT);
      const probe = Uint8Array.of(1);
      await probeEntry.setSecret(probe, signal);
      const read = await probeEntry.getSecret(signal);
      try {
        await probeEntry.deleteCredential(signal);
      } catch {
        // Probe cleanup is best-effort. A later probe overwrites the same account.
      }
      return read != null && read.length === probe.length && read[0] === probe[0];
    },
    get: async (account, signal) => {
      try {
        const read = await entry(account).getSecret(signal);
        return read == null ? undefined : Uint8Array.from(read);
      } catch (cause) {
        if (isMissingEntry(cause)) {
          return undefined;
        }
        throw cause;
      }
    },
    set: (account, value, signal) => entry(account).setSecret(value, signal),
    delete: async (account, signal) => {
      try {
        await entry(account).deleteCredential(signal);
      } catch (cause) {
        if (isMissingEntry(cause)) {
          return;
        }
        throw cause;
      }
    },
  };
}

/** Lazy require. A missing prebuild or a musl/glibc mismatch throws here. */
function loadNativeKeyringPort(): KeychainPort {
  let loaded: { readonly AsyncEntry?: unknown };
  try {
    loaded = requireKeyring("@napi-rs/keyring") as { readonly AsyncEntry?: unknown };
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error("Failed to load native binding");
  }
  if (typeof loaded.AsyncEntry !== "function") {
    throw new Error("OS keychain native binding is missing.");
  }
  return portFromAsyncEntry(
    loaded.AsyncEntry as new (service: string, username: string) => KeyringAsyncEntry,
  );
}

let loggedFileFallback = false;

/** Static text only. Callers must not attach secret names or values. */
export const logOsKeychainFileFallback = Effect.suspend(() => {
  if (loggedFileFallback) {
    return Effect.void;
  }
  loggedFileFallback = true;
  return Effect.logWarning(
    "OS keychain is unavailable. Provider secrets will stay in the local file store.",
  );
});

export function resetOsKeychainFallbackLogForTests(): void {
  loggedFileFallback = false;
}

export function layerFromDouble(state: KeychainDouble): Layer.Layer<OsKeychain> {
  return Layer.succeed(
    OsKeychain,
    OsKeychain.of({
      kind: "keychain",
      fallback: false,
      get: (account) =>
        Effect.sync(() => {
          const value = state.entries.get(account);
          if (value === undefined) {
            return Option.none();
          }
          if (state.corruptRead) {
            return Option.some(Uint8Array.of(0));
          }
          return Option.some(Uint8Array.from(value));
        }),
      set: (account, value) =>
        Effect.try({
          try: () => {
            if (state.failSet) {
              throw new Error("keychain set failed");
            }
            state.entries.set(account, Uint8Array.from(value));
          },
          catch: (cause) => keychainFailure("set", "failed", cause),
        }),
      delete: (account) =>
        Effect.try({
          try: () => {
            if (state.failDelete) {
              throw new Error("keychain delete failed");
            }
            state.entries.delete(account);
          },
          catch: (cause) => keychainFailure("delete", "failed", cause),
        }),
    }),
  );
}

const makePortService = (port: KeychainPort, timeout: Duration.Duration) =>
  Effect.gen(function* () {
    const disabled = yield* Ref.make(false);
    const disableForRun = Ref.set(disabled, true).pipe(Effect.andThen(logOsKeychainFileFallback));

    const run = <A>(
      operation: "get" | "set" | "delete",
      task: (signal: AbortSignal) => Promise<A>,
    ) =>
      Effect.gen(function* () {
        if (yield* Ref.get(disabled)) {
          return yield* keychainFailure(
            operation,
            "timeout",
            new Error("OS keychain is disabled for this run."),
          );
        }
        return yield* bounded(operation, timeout, task).pipe(
          Effect.catchTag("KeychainError", (error) =>
            isKeychainUnavailable(error)
              ? disableForRun.pipe(Effect.andThen(Effect.fail(error)))
              : Effect.fail(error),
          ),
        );
      });

    return OsKeychain.of({
      kind: "keychain",
      fallback: false,
      get: (account) =>
        run("get", (signal) => port.get(account, signal)).pipe(
          Effect.map((value) => (value == null ? Option.none() : Option.some(value))),
        ),
      set: (account, value) => run("set", (signal) => port.set(account, value, signal)),
      delete: (account) => run("delete", (signal) => port.delete(account, signal)),
    });
  });

function probePort(port: KeychainPort, timeout: Duration.Duration): Effect.Effect<boolean, never> {
  return bounded("probe", timeout, (signal) => port.probe(signal)).pipe(
    Effect.match({
      onFailure: () => false,
      onSuccess: (available) => available,
    }),
  );
}

function resolvePort(options: OpenKeychainLayerOptions | undefined): KeychainPort | undefined {
  if (options?.port) {
    return options.port;
  }
  try {
    return (options?.load ?? loadNativeKeyringPort)();
  } catch {
    return undefined;
  }
}

/**
 * Builds the keychain layer. Pass `port` or `load` from tests so a hung probe
 * or a missing prebuild never touches the real addon or `process.env`.
 */
export function openKeychainLayer(options?: OpenKeychainLayerOptions): Layer.Layer<OsKeychain> {
  return Layer.unwrap(
    Effect.gen(function* () {
      const env = options?.env ?? {
        vitest: process.env.VITEST,
        secretStore: process.env.E6CODE_SECRET_STORE,
      };
      if (selectSecretBackend(env) === "file") {
        return fileLayer(false);
      }
      const timeout = options?.timeout ?? KEYCHAIN_OPERATION_TIMEOUT;
      const port = resolvePort(options);
      if (port === undefined) {
        yield* logOsKeychainFileFallback;
        return fileLayer(true);
      }
      const available = yield* probePort(port, timeout);
      if (!available) {
        yield* logOsKeychainFileFallback;
        return fileLayer(true);
      }
      return Layer.effect(OsKeychain, makePortService(port, timeout));
    }),
  );
}

export const layer = openKeychainLayer();
