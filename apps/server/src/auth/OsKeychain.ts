// @effect-diagnostics nodeBuiltinImport:off - createRequire loads the external native addon from disk, including inside the CLI bundle.
import * as NodeModule from "node:module";

import type { Entry } from "@napi-rs/keyring";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class KeychainError extends Schema.TaggedError<KeychainError>()("KeychainError", {
  operation: Schema.Literals(["get", "set", "delete"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `OS keychain ${this.operation} failed.`;
  }
}

const keychainFailure = (operation: "get" | "set" | "delete", cause: unknown) =>
  new KeychainError({ operation, cause });

/**
 * OS credential store for provider secrets.
 *
 * The desktop app spawns `bin.mjs` as its own Node process, and `e6 serve` has
 * no Electron process at all, so Electron `safeStorage` is not available here.
 * `@napi-rs/keyring` (MIT, napi-rs prebuilds) talks to the macOS Keychain,
 * Windows Credential Manager, and Linux Secret Service from this process. The
 * desktop app already depends on the same package for Chromium cookie import.
 */
const KEYCHAIN_SERVICE = "com.e6code.secrets";
const PROBE_ACCOUNT = "e6-keychain-probe";
const SAFE_SECRET_NAME = /^[A-Za-z0-9_-]{1,200}$/;

const requireKeyring = NodeModule.createRequire(import.meta.url);

interface KeyringModule {
  Entry: new (service: string, username: string) => Entry;
}

export class OsKeychain extends Context.Service<
  OsKeychain,
  {
    readonly kind: "file" | "keychain";
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

const unavailable = Effect.die("File secret backend does not read the OS keychain.");

const fileService = OsKeychain.of({
  kind: "file",
  get: () => unavailable,
  set: () => unavailable,
  delete: () => unavailable,
});

const fileLayer = Layer.succeed(OsKeychain, fileService);

function isMissingEntry(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }
  const record = cause as { readonly message?: unknown; readonly code?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  const code = typeof record.code === "string" ? record.code : "";
  return message.includes("NoEntry") || code.includes("NoEntry");
}

function loadKeyring(): KeyringModule {
  return requireKeyring("@napi-rs/keyring") as KeyringModule;
}

function entryFor(keyring: KeyringModule, account: string): Entry {
  return new keyring.Entry(KEYCHAIN_SERVICE, account);
}

function makeNativeService(keyring: KeyringModule): OsKeychain["Service"] {
  return OsKeychain.of({
    kind: "keychain",
    get: (account) =>
      Effect.try({
        try: (): Option.Option<Uint8Array> => {
          try {
            const read = entryFor(keyring, account).getSecret();
            return read == null ? Option.none() : Option.some(Uint8Array.from(read));
          } catch (cause) {
            if (isMissingEntry(cause)) {
              return Option.none();
            }
            throw cause;
          }
        },
        catch: (cause) => keychainFailure("get", cause),
      }),
    set: (account, value) =>
      Effect.try({
        try: () => {
          entryFor(keyring, account).setSecret(value);
        },
        catch: (cause) => keychainFailure("set", cause),
      }),
    delete: (account) =>
      Effect.try({
        try: () => {
          try {
            entryFor(keyring, account).deleteCredential();
          } catch (cause) {
            if (isMissingEntry(cause)) {
              return;
            }
            throw cause;
          }
        },
        catch: (cause) => keychainFailure("delete", cause),
      }),
  });
}

function probeNativeKeychain(): boolean {
  const keyring = loadKeyring();
  const entry = entryFor(keyring, PROBE_ACCOUNT);
  const probe = Uint8Array.of(1);
  entry.setSecret(probe);
  const read = entry.getSecret();
  try {
    entry.deleteCredential();
  } catch {
    // Probe cleanup is best-effort. A later probe overwrites the same account.
  }
  return read != null && read.length === probe.length && read[0] === probe[0];
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
          catch: (cause) => keychainFailure("set", cause),
        }),
      delete: (account) =>
        Effect.try({
          try: () => {
            if (state.failDelete) {
              throw new Error("keychain delete failed");
            }
            state.entries.delete(account);
          },
          catch: (cause) => keychainFailure("delete", cause),
        }),
    }),
  );
}

const nativeLayer = Layer.sync(OsKeychain, () => makeNativeService(loadKeyring()));

export const layer = Layer.unwrap(
  Effect.sync(() => {
    const choice = selectSecretBackend({
      vitest: process.env.VITEST,
      secretStore: process.env.E6CODE_SECRET_STORE,
    });
    if (choice === "file") {
      return fileLayer;
    }
    return Layer.unwrap(
      Effect.gen(function* () {
        const available = yield* Effect.sync(() => {
          try {
            return probeNativeKeychain();
          } catch {
            return false;
          }
        });
        if (!available) {
          yield* logOsKeychainFileFallback;
          return fileLayer;
        }
        return nativeLayer;
      }),
    );
  }),
);
