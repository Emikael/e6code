/**
 * Tracks which preview partitions received cookies imported from the user's
 * real browser, and which tabs the user has allowed an agent to drive.
 *
 * The ledger is durable because the cookies themselves survive restart. The
 * approval map is not: quitting the app forgets every grant. Nothing in this
 * module reads or writes client settings, and `approveTab` is only reached
 * from the desktop confirm dialog's IPC handler.
 *
 * @module AgentImportedCookieAccess
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
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

export class AgentImportedCookieApprovalError extends Schema.TaggedError<AgentImportedCookieApprovalError>()(
  "AgentImportedCookieApprovalError",
  { tabId: Schema.String },
) {
  override get message(): string {
    return `Tab ${this.tabId} has no imported-cookie partition to approve.`;
  }
}

/**
 * Whether an agent action against `partition` may run.
 *
 * An unknown partition is allowed: the caller has not identified a store that
 * holds imported cookies. Agent partitions and user partitions with no import
 * record are allowed and do not count as using imported cookies. A partition
 * that received an import is allowed only when this tab was approved for that
 * same partition.
 */
export function decideAgentPartitionAccess(input: {
  readonly partition: string | null;
  readonly record: ImportedCookiePartitionRecord | null;
  readonly approvedPartition: string | null;
}): AgentPartitionAccess {
  if (input.partition === null || isAgentPartition(input.partition) || input.record === null) {
    return { _tag: "Allow", usesImportedCookies: false };
  }
  if (input.record.partition !== input.partition) {
    return { _tag: "Allow", usesImportedCookies: false };
  }
  if (input.approvedPartition === input.partition) {
    return { _tag: "Allow", usesImportedCookies: true };
  }
  return {
    _tag: "NeedsApproval",
    browserName: input.record.sourceName,
    profileId: input.record.profileId,
  };
}

const decodeLedger = Schema.decodeUnknownOption(Schema.fromJsonString(ImportedCookieLedgerFile));
const encodeLedger = Schema.encodeSync(Schema.fromJsonString(ImportedCookieLedgerFile));

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
  }
>()("@e6tools/desktop/preview/AgentImportedCookieAccess") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* AgentImportedCookieAccessMake() {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const stateDir = environment.stateDir;
  const ledgerPath =
    typeof stateDir === "string" && stateDir.length > 0
      ? path.join(stateDir, "imported-cookie-partitions.json")
      : undefined;

  const ledgerRef = yield* Ref.make<ReadonlyMap<string, ImportedCookiePartitionRecord>>(new Map());
  // tab id → partition the user approved. Process memory only.
  const approvalsRef = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const bindingsRef = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

  const persist = Effect.fn("AgentImportedCookieAccess.persist")(function* (
    ledger: ReadonlyMap<string, ImportedCookiePartitionRecord>,
  ) {
    if (ledgerPath === undefined) return;
    const contents = encodeLedger({ version: 1, partitions: [...ledger.values()] });
    yield* fileSystem.writeFileString(ledgerPath, contents).pipe(Effect.ignore);
  });

  if (ledgerPath !== undefined) {
    const raw = yield* fileSystem.readFileString(ledgerPath).pipe(Effect.orElseSucceed(() => ""));
    const decoded = raw.length === 0 ? undefined : decodeLedger(raw);
    if (decoded && decoded._tag === "Some") {
      yield* Ref.set(
        ledgerRef,
        new Map(decoded.value.partitions.map((entry) => [entry.partition, entry])),
      );
    }
  }

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

  const forgetPartitions = Effect.fn("AgentImportedCookieAccess.forgetPartitions")(function* (
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
  });

  const lookup = (ledger: ReadonlyMap<string, ImportedCookiePartitionRecord>, partition: string) =>
    ledger.get(partition) ?? null;

  const decide = Effect.fn("AgentImportedCookieAccess.decide")(function* (
    tabId: string,
    partition: string | null,
  ) {
    const ledger = yield* Ref.get(ledgerRef);
    const approvals = yield* Ref.get(approvalsRef);
    return decideAgentPartitionAccess({
      partition,
      record: partition === null ? null : lookup(ledger, partition),
      approvedPartition: approvals.get(tabId) ?? null,
    });
  });

  return AgentImportedCookieAccess.of({
    recordImport,
    forgetPartitions,
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
      const record =
        partition === undefined ? undefined : (yield* Ref.get(ledgerRef)).get(partition);
      if (
        partition === undefined ||
        record === undefined ||
        isAgentPartition(partition) ||
        record.partition !== partition
      ) {
        return yield* new AgentImportedCookieApprovalError({ tabId });
      }
      yield* Ref.update(approvalsRef, (approvals) => new Map(approvals).set(tabId, partition));
      return record;
    }),
    revokeTab: (tabId) =>
      Ref.update(approvalsRef, (approvals) => {
        if (!approvals.has(tabId)) return approvals;
        const next = new Map(approvals);
        next.delete(tabId);
        return next;
      }),
  });
});

export const layer = Layer.effect(AgentImportedCookieAccess, make);
