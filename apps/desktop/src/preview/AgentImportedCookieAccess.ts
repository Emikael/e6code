/**
 * Tracks which preview partitions hold cookies an agent must not use, and
 * which tabs the user has allowed an agent to drive.
 *
 * The ledger is durable because imported cookies survive restart. Approval,
 * denial, and the prompt throttle are not: quitting the app forgets them.
 * Nothing here reads or writes client settings. `approveTab` is only reached
 * from the desktop window's IPC handler.
 *
 * Absence of a ledger row is not evidence the partition is safe. Only the
 * agent partition is allowed with no approval. A user partition is allowed
 * without a prompt only when the ledger is readable and the jar is empty or
 * localhost-only.
 *
 * @module AgentImportedCookieAccess
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { isAgentPartition } from "./BrowserSession.ts";

const ImportedCookieLedgerEntry = Schema.Struct({
  partition: Schema.String,
  sourceId: Schema.String,
  sourceName: Schema.String,
  profileId: Schema.String,
});
type ImportedCookieLedgerEntry = typeof ImportedCookieLedgerEntry.Type;

const ImportedCookieLedgerFile = Schema.Struct({
  version: Schema.Literal(1),
  partitions: Schema.Array(ImportedCookieLedgerEntry),
});

export interface ImportedCookiePartitionRecord {
  readonly partition: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly profileId: string;
}

export type AgentPartitionAccess =
  | { readonly _tag: "Allow"; readonly usesImportedCookies: boolean }
  | {
      readonly _tag: "NeedsApproval";
      readonly browserName: string;
      readonly profileId: string;
    };

export interface AgentImportedCookieAccessStatus {
  readonly holdsImportedCookies: boolean;
  readonly approved: boolean;
  readonly browserName: string | null;
  readonly profileId: string | null;
}

export interface AgentImportedCookiePrompt {
  readonly allowed: boolean;
}

const PROMPT_MIN_INTERVAL_MS = 60_000;
const EXISTING_SESSION_RECORD = {
  sourceId: "existing-session",
  sourceName: "this preview",
  profileId: "existing",
} as const;

export class AgentImportedCookieApprovalError extends Schema.TaggedError<AgentImportedCookieApprovalError>()(
  "AgentImportedCookieApprovalError",
  { tabId: Schema.String },
) {
  override get message(): string {
    return `Tab ${this.tabId} has no preview partition to approve.`;
  }
}

/** A cookie-jar or partition-directory read that could not be trusted. */
export class PartitionCookieProbeError extends Schema.TaggedError<PartitionCookieProbeError>()(
  "PartitionCookieProbeError",
  { cause: Schema.Defect() },
) {}

const probeError = (cause: unknown) => new PartitionCookieProbeError({ cause });

/**
 * Hosts that belong to the machine running the preview. An empty host is not
 * local: a cookie we cannot name has to be treated as a real site.
 */
export function isLocalPreviewCookieHost(host: string): boolean {
  const stripped = host.trim().toLowerCase().replace(/^\.+/, "");
  const normalized =
    stripped.startsWith("[") && stripped.endsWith("]") ? stripped.slice(1, -1) : stripped;
  if (normalized.length === 0) return false;
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0.0.0.0"
  );
}

function partitionHasNonLocalhostCookies(hosts: ReadonlyArray<string>): boolean {
  return hosts.some((host) => !isLocalPreviewCookieHost(host));
}

/**
 * Whether an agent action against `partition` may run.
 *
 * The agent partition is allowed because cookie import cannot write it, even
 * when the ledger cannot be read. Every other partition needs approval when
 * the partition is unknown, the ledger is unreadable, a ledger row names it,
 * or its cookie jar holds anything that is not localhost. An in-memory
 * approval for that same partition is the only exception.
 */
export function decideAgentPartitionAccess(input: {
  readonly partition: string | null;
  readonly record: ImportedCookiePartitionRecord | null;
  readonly approvedPartition: string | null;
  readonly ledgerTrustworthy: boolean;
  readonly hasNonLocalhostCookies: boolean;
}): AgentPartitionAccess {
  if (input.partition !== null && isAgentPartition(input.partition)) {
    return { _tag: "Allow", usesImportedCookies: false };
  }
  if (input.partition !== null && input.approvedPartition === input.partition) {
    return { _tag: "Allow", usesImportedCookies: true };
  }
  if (input.partition === null || !input.ledgerTrustworthy) {
    return {
      _tag: "NeedsApproval",
      browserName: input.record?.sourceName ?? EXISTING_SESSION_RECORD.sourceName,
      profileId: input.record?.profileId ?? "unknown",
    };
  }
  if (input.record !== null && input.record.partition === input.partition) {
    return {
      _tag: "NeedsApproval",
      browserName: input.record.sourceName,
      profileId: input.record.profileId,
    };
  }
  if (input.hasNonLocalhostCookies) {
    return {
      _tag: "NeedsApproval",
      browserName: EXISTING_SESSION_RECORD.sourceName,
      profileId: EXISTING_SESSION_RECORD.profileId,
    };
  }
  return { _tag: "Allow", usesImportedCookies: false };
}

const decodeLedger = Schema.decodeUnknownOption(Schema.fromJsonString(ImportedCookieLedgerFile));
const encodeLedger = Schema.encodeSync(Schema.fromJsonString(ImportedCookieLedgerFile));

const isNotFound = (error: PlatformError.PlatformError) => error.reason._tag === "NotFound";

export class PartitionCookieProbe extends Context.Service<
  PartitionCookieProbe,
  {
    readonly listHosts: (
      partition: string,
    ) => Effect.Effect<ReadonlyArray<string>, PartitionCookieProbeError>;
    readonly discoverPreviewPartitions: Effect.Effect<
      ReadonlyArray<string>,
      PartitionCookieProbeError
    >;
  }
>()("@e6tools/desktop/preview/AgentImportedCookieAccess/PartitionCookieProbe") {}

const logProbeFailure = (message: string, cause: unknown) =>
  Effect.logError(`${message}: ${cause instanceof Error ? cause.message : String(cause)}`);

export const electronPartitionCookieProbeLayer = Layer.effect(
  PartitionCookieProbe,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const loadElectron = Effect.tryPromise({
      try: () => import("electron"),
      catch: probeError,
    });

    return PartitionCookieProbe.of({
      listHosts: (partition) =>
        Effect.tryPromise({
          try: async () => {
            const { session } = await import("electron");
            const cookies = await session.fromPartition(partition).cookies.get({});
            return cookies.map((cookie) => cookie.domain ?? "");
          },
          catch: probeError,
        }),
      discoverPreviewPartitions: Effect.gen(function* () {
        const electron = yield* loadElectron.pipe(Effect.orElseSucceed(() => null));
        if (electron === null) return [];
        const app = yield* Effect.try({
          try: () => electron.app,
          catch: probeError,
        }).pipe(Effect.orElseSucceed(() => null));
        if (app == null || typeof app.isReady !== "function" || !app.isReady()) {
          return [];
        }
        const directory = path.join(app.getPath("userData"), "Partitions");
        const entries = yield* fileSystem
          .readDirectory(directory)
          .pipe(
            Effect.catch(
              (error): Effect.Effect<ReadonlyArray<string>, PartitionCookieProbeError> =>
                isNotFound(error)
                  ? Effect.succeed([])
                  : Effect.fail(new PartitionCookieProbeError({ cause: error })),
            ),
          );
        const partitions: Array<string> = [];
        for (const name of entries) {
          if (!name.startsWith("e6code-preview-")) continue;
          const partition = `persist:${name}`;
          if (isAgentPartition(partition)) continue;
          partitions.push(partition);
        }
        return partitions;
      }),
    });
  }),
);

interface PromptGate {
  readonly denied: ReadonlySet<string>;
  readonly pending: ReadonlySet<string>;
  readonly lastPromptAt: ReadonlyMap<string, number>;
}

const emptyPromptGate = (): PromptGate => ({
  denied: new Set(),
  pending: new Set(),
  lastPromptAt: new Map(),
});

export class AgentImportedCookieAccess extends Context.Service<
  AgentImportedCookieAccess,
  {
    readonly recordImport: (entry: ImportedCookiePartitionRecord) => Effect.Effect<void, never>;
    readonly forgetPartitions: (
      partitions: ReadonlyArray<string> | undefined,
    ) => Effect.Effect<ReadonlyArray<string>>;
    readonly bindTab: (tabId: string, partition: string) => Effect.Effect<void>;
    readonly unbindTab: (tabId: string) => Effect.Effect<void>;
    readonly partitionForTab: (tabId: string) => Effect.Effect<string | undefined>;
    readonly describe: (
      tabId: string,
      partition: string | null,
    ) => Effect.Effect<AgentImportedCookieAccessStatus>;
    readonly decide: (
      tabId: string,
      partition: string | null,
    ) => Effect.Effect<AgentPartitionAccess>;
    readonly approveTab: (
      tabId: string,
    ) => Effect.Effect<ImportedCookiePartitionRecord, AgentImportedCookieApprovalError>;
    readonly revokeTab: (tabId: string) => Effect.Effect<void>;
    readonly beginPrompt: (tabId: string) => Effect.Effect<AgentImportedCookiePrompt>;
    readonly finishPrompt: (tabId: string) => Effect.Effect<void>;
    readonly denyTab: (tabId: string) => Effect.Effect<void>;
  }
>()("@e6tools/desktop/preview/AgentImportedCookieAccess") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* AgentImportedCookieAccessMake() {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const probe = yield* PartitionCookieProbe;
  const stateDir = environment.stateDir;
  const ledgerPath =
    typeof stateDir === "string" && stateDir.length > 0
      ? path.join(stateDir, "imported-cookie-partitions.json")
      : undefined;

  const ledgerRef = yield* Ref.make<ReadonlyMap<string, ImportedCookiePartitionRecord>>(new Map());
  const trustworthyRef = yield* Ref.make(true);
  const approvalsRef = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const bindingsRef = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const promptGateRef = yield* Ref.make<PromptGate>(emptyPromptGate());

  const markUntrustworthy = Ref.set(trustworthyRef, false);

  const persist = Effect.fn("AgentImportedCookieAccess.persist")(function* (
    ledger: ReadonlyMap<string, ImportedCookiePartitionRecord>,
  ) {
    if (ledgerPath === undefined) return;
    const contents = encodeLedger({ version: 1, partitions: [...ledger.values()] });
    const temporaryPath = `${ledgerPath}.tmp`;
    const written = yield* fileSystem.writeFileString(temporaryPath, contents).pipe(
      Effect.flatMap(() => fileSystem.rename(temporaryPath, ledgerPath)),
      Effect.as(true),
      Effect.tapError((cause) =>
        logProbeFailure("Failed to persist the imported-cookie ledger", cause),
      ),
      Effect.orElseSucceed(() => false),
    );
    if (!written) yield* markUntrustworthy;
  });

  const nonLocalhostCookies = (partition: string) =>
    probe.listHosts(partition).pipe(
      Effect.map(partitionHasNonLocalhostCookies),
      Effect.tapError((cause) =>
        logProbeFailure(`Failed to read preview cookies for ${partition}`, cause),
      ),
      Effect.orElseSucceed(() => true),
    );

  const recordImport = Effect.fn("AgentImportedCookieAccess.recordImport")(function* (
    entry: ImportedCookiePartitionRecord,
  ) {
    if (isAgentPartition(entry.partition)) return;
    const next = yield* Ref.modify(ledgerRef, (ledger) => {
      const updated = new Map(ledger);
      updated.set(entry.partition, entry);
      return [updated, updated] as const;
    });
    yield* persist(next);
  });

  if (ledgerPath !== undefined) {
    type LedgerFileRead =
      | { readonly _tag: "Read"; readonly value: string }
      | { readonly _tag: "Missing" }
      | { readonly _tag: "Unreadable"; readonly error: PlatformError.PlatformError };
    const raw = yield* fileSystem.readFileString(ledgerPath).pipe(
      Effect.map((value): LedgerFileRead => ({ _tag: "Read", value })),
      Effect.catch((error): Effect.Effect<LedgerFileRead> =>
        Effect.succeed(isNotFound(error) ? { _tag: "Missing" } : { _tag: "Unreadable", error }),
      ),
    );
    if (raw._tag === "Unreadable") {
      yield* logProbeFailure("Failed to read the imported-cookie ledger", raw.error);
      yield* markUntrustworthy;
    } else if (raw._tag === "Read") {
      const decoded = raw.value.length === 0 ? undefined : decodeLedger(raw.value);
      if (decoded?._tag === "Some") {
        yield* Ref.set(
          ledgerRef,
          new Map(decoded.value.partitions.map((entry) => [entry.partition, entry])),
        );
      } else {
        yield* Effect.logError("Imported-cookie ledger is empty or not valid JSON");
        yield* markUntrustworthy;
      }
    }
  }

  const discovered = yield* probe.discoverPreviewPartitions.pipe(
    Effect.catch((cause) =>
      Effect.gen(function* () {
        yield* logProbeFailure("Failed to scan existing preview partitions", cause);
        yield* markUntrustworthy;
        return [] as ReadonlyArray<string>;
      }),
    ),
  );
  const ledger = yield* Ref.get(ledgerRef);
  for (const partition of discovered) {
    if (ledger.has(partition) || isAgentPartition(partition)) continue;
    if (!(yield* nonLocalhostCookies(partition))) continue;
    yield* recordImport({ partition, ...EXISTING_SESSION_RECORD });
  }

  const lookup = (ledger: ReadonlyMap<string, ImportedCookiePartitionRecord>, partition: string) =>
    ledger.get(partition) ?? null;

  const decide = Effect.fn("AgentImportedCookieAccess.decide")(function* (
    tabId: string,
    partition: string | null,
  ) {
    const [currentLedger, trustworthy, approvals] = yield* Effect.all([
      Ref.get(ledgerRef),
      Ref.get(trustworthyRef),
      Ref.get(approvalsRef),
    ]);
    const record = partition === null ? null : lookup(currentLedger, partition);
    const hasNonLocalhostCookies =
      partition === null ||
      isAgentPartition(partition) ||
      !trustworthy ||
      record !== null ||
      approvals.get(tabId) === partition
        ? false
        : yield* nonLocalhostCookies(partition);
    return decideAgentPartitionAccess({
      partition,
      record,
      approvedPartition: approvals.get(tabId) ?? null,
      ledgerTrustworthy: trustworthy,
      hasNonLocalhostCookies,
    });
  });

  return AgentImportedCookieAccess.of({
    recordImport,
    forgetPartitions: Effect.fn("AgentImportedCookieAccess.forgetPartitions")(function* (
      partitions: ReadonlyArray<string> | undefined,
    ) {
      const forgotten = yield* Ref.modify(ledgerRef, (ledger) => {
        if (partitions === undefined) {
          return [[...ledger.keys()], new Map()] as const;
        }
        const updated = new Map(ledger);
        const removed: Array<string> = [];
        for (const partition of partitions) {
          if (updated.delete(partition)) removed.push(partition);
        }
        return [removed, updated] as const;
      });
      if (forgotten.length > 0) {
        yield* persist(yield* Ref.get(ledgerRef));
      }
      const dropped = new Set(forgotten);
      return yield* Ref.modify(approvalsRef, (approvals) => {
        const tabIds: Array<string> = [];
        const next = new Map(approvals);
        for (const [tabId, partition] of approvals) {
          if (partitions === undefined || dropped.has(partition)) {
            next.delete(tabId);
            tabIds.push(tabId);
          }
        }
        return [tabIds, next] as const;
      });
    }),
    bindTab: (tabId, partition) =>
      Ref.update(bindingsRef, (bindings) => new Map(bindings).set(tabId, partition)),
    unbindTab: (tabId) =>
      Ref.update(bindingsRef, (bindings) => {
        if (!bindings.has(tabId)) return bindings;
        const next = new Map(bindings);
        next.delete(tabId);
        return next;
      }),
    partitionForTab: (tabId) => Effect.map(Ref.get(bindingsRef), (bindings) => bindings.get(tabId)),
    describe: Effect.fn("AgentImportedCookieAccess.describe")(function* (tabId, partition) {
      const decision = yield* decide(tabId, partition);
      if (decision._tag === "NeedsApproval") {
        return {
          holdsImportedCookies: true,
          approved: false,
          browserName: decision.browserName,
          profileId: decision.profileId,
        };
      }
      const record = partition === null ? null : lookup(yield* Ref.get(ledgerRef), partition);
      return {
        holdsImportedCookies: decision.usesImportedCookies || record !== null,
        approved: decision.usesImportedCookies,
        browserName: record?.sourceName ?? null,
        profileId: record?.profileId ?? null,
      };
    }),
    decide,
    approveTab: Effect.fn("AgentImportedCookieAccess.approveTab")(function* (tabId: string) {
      const partition = (yield* Ref.get(bindingsRef)).get(tabId);
      if (partition === undefined || isAgentPartition(partition)) {
        return yield* new AgentImportedCookieApprovalError({ tabId });
      }
      const existing = (yield* Ref.get(ledgerRef)).get(partition);
      const record: ImportedCookiePartitionRecord = existing ?? {
        partition,
        ...EXISTING_SESSION_RECORD,
      };
      if (existing === undefined) yield* recordImport(record);
      yield* Ref.update(approvalsRef, (approvals) => new Map(approvals).set(tabId, partition));
      yield* Ref.update(promptGateRef, (gate) => {
        if (!gate.denied.has(tabId)) return gate;
        const denied = new Set(gate.denied);
        denied.delete(tabId);
        return { ...gate, denied };
      });
      return record;
    }),
    revokeTab: (tabId) =>
      Ref.update(approvalsRef, (approvals) => {
        if (!approvals.has(tabId)) return approvals;
        const next = new Map(approvals);
        next.delete(tabId);
        return next;
      }),
    beginPrompt: Effect.fn("AgentImportedCookieAccess.beginPrompt")(function* (tabId: string) {
      const now = yield* Clock.currentTimeMillis;
      return yield* Ref.modify(
        promptGateRef,
        (gate): readonly [AgentImportedCookiePrompt, PromptGate] => {
          if (gate.denied.has(tabId) || gate.pending.has(tabId)) {
            return [{ allowed: false }, gate];
          }
          const last = gate.lastPromptAt.get(tabId);
          if (last !== undefined && now - last < PROMPT_MIN_INTERVAL_MS) {
            return [{ allowed: false }, gate];
          }
          const pending = new Set(gate.pending);
          pending.add(tabId);
          const lastPromptAt = new Map(gate.lastPromptAt);
          lastPromptAt.set(tabId, now);
          return [{ allowed: true }, { ...gate, pending, lastPromptAt }];
        },
      );
    }),
    finishPrompt: (tabId) =>
      Ref.update(promptGateRef, (gate) => {
        if (!gate.pending.has(tabId)) return gate;
        const pending = new Set(gate.pending);
        pending.delete(tabId);
        return { ...gate, pending };
      }),
    denyTab: (tabId) =>
      Ref.update(promptGateRef, (gate) => {
        const denied = new Set(gate.denied);
        denied.add(tabId);
        const pending = new Set(gate.pending);
        pending.delete(tabId);
        return { ...gate, denied, pending };
      }),
  });
});

export const layer = Layer.effect(AgentImportedCookieAccess, make);
