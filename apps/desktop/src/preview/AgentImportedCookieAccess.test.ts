import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PREVIEW_AUTOMATION_OPERATIONS, WS_METHODS } from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  AgentImportedCookieAccess,
  AgentImportedCookieApprovalError,
  decideAgentPartitionAccess,
  isLocalPreviewCookieHost,
  layer,
  PartitionCookieProbe,
  PartitionCookieProbeError,
} from "./AgentImportedCookieAccess.ts";

const USER_PARTITION = "persist:e6code-preview-user";
const AGENT_PARTITION = "persist:e6code-preview-agent-abc";

const chrome = {
  partition: USER_PARTITION,
  sourceId: "chrome",
  sourceName: "Chrome",
  profileId: "work",
};

const accessLayer = (
  stateDir: string,
  hosts: (partition: string) => ReadonlyArray<string> | undefined = () => [],
  discover: ReadonlyArray<string> = [],
  listFails = false,
) =>
  layer.pipe(
    Layer.provide(
      Layer.succeed(
        PartitionCookieProbe,
        PartitionCookieProbe.of({
          listHosts: (partition) =>
            listFails
              ? Effect.fail(new PartitionCookieProbeError({ cause: "unreadable cookie jar" }))
              : Effect.succeed(hosts(partition) ?? []),
          discoverPreviewPartitions: Effect.succeed(discover),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        stateDir,
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
    ),
    Layer.provide(NodeServices.layer),
  );

describe("decideAgentPartitionAccess", () => {
  it("allows an agent partition even when the ledger cannot be read", () => {
    assert.deepStrictEqual(
      decideAgentPartitionAccess({
        partition: AGENT_PARTITION,
        record: { ...chrome, partition: AGENT_PARTITION },
        approvedPartition: null,
        ledgerTrustworthy: false,
        hasNonLocalhostCookies: true,
      }),
      { _tag: "Allow", usesImportedCookies: false },
    );
  });

  it("requires approval for an unknown partition and an unrecorded site jar", () => {
    assert.strictEqual(
      decideAgentPartitionAccess({
        partition: null,
        record: null,
        approvedPartition: null,
        ledgerTrustworthy: true,
        hasNonLocalhostCookies: false,
      })._tag,
      "NeedsApproval",
    );
    assert.strictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: null,
        approvedPartition: null,
        ledgerTrustworthy: true,
        hasNonLocalhostCookies: true,
      })._tag,
      "NeedsApproval",
    );
    assert.deepStrictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: null,
        approvedPartition: null,
        ledgerTrustworthy: true,
        hasNonLocalhostCookies: false,
      }),
      { _tag: "Allow", usesImportedCookies: false },
    );
  });

  it("treats a corrupt ledger as imported until this tab is approved", () => {
    assert.strictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: null,
        approvedPartition: null,
        ledgerTrustworthy: false,
        hasNonLocalhostCookies: false,
      })._tag,
      "NeedsApproval",
    );
    assert.deepStrictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: null,
        approvedPartition: USER_PARTITION,
        ledgerTrustworthy: false,
        hasNonLocalhostCookies: true,
      }),
      { _tag: "Allow", usesImportedCookies: true },
    );
  });

  it("requires approval for an imported partition and allows it after", () => {
    assert.strictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: chrome,
        approvedPartition: null,
        ledgerTrustworthy: true,
        hasNonLocalhostCookies: false,
      })._tag,
      "NeedsApproval",
    );
    assert.deepStrictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: chrome,
        approvedPartition: USER_PARTITION,
        ledgerTrustworthy: true,
        hasNonLocalhostCookies: true,
      }),
      { _tag: "Allow", usesImportedCookies: true },
    );
  });

  it("does not treat a blank cookie host as localhost", () => {
    assert.isFalse(isLocalPreviewCookieHost(""));
    assert.isFalse(isLocalPreviewCookieHost("."));
    assert.isTrue(isLocalPreviewCookieHost(".localhost"));
    assert.isTrue(isLocalPreviewCookieHost("[::1]"));
    assert.isFalse(isLocalPreviewCookieHost(".github.com"));
  });
});

describe("AgentImportedCookieAccess", () => {
  it.effect("prompts for an empty ledger when the jar has a site cookie", () =>
    Effect.gen(function* () {
      const access = yield* AgentImportedCookieAccess.pipe(
        Effect.provide(
          accessLayer("", (partition) =>
            partition === USER_PARTITION ? [".github.com"] : ["localhost"],
          ),
        ),
      );
      yield* access.bindTab("tab-1", USER_PARTITION);
      const site = yield* access.decide("tab-1", USER_PARTITION);
      assert.strictEqual(site._tag, "NeedsApproval");
      if (site._tag === "NeedsApproval") {
        assert.strictEqual(site.browserName, "this preview");
      }

      const local = yield* access.decide("local-tab", "persist:e6code-preview-local");
      assert.deepStrictEqual(local, { _tag: "Allow", usesImportedCookies: false });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("records existing site partitions at startup and skips localhost jars", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "e6code-cookie-migrate-",
      });
      const localPartition = "persist:e6code-preview-local";
      const access = yield* AgentImportedCookieAccess.pipe(
        Effect.provide(
          accessLayer(
            stateDir,
            (partition) => (partition === USER_PARTITION ? ["github.com"] : ["127.0.0.1"]),
            [USER_PARTITION, localPartition, AGENT_PARTITION],
          ),
        ),
      );
      assert.strictEqual((yield* access.decide("tab-1", USER_PARTITION))._tag, "NeedsApproval");
      assert.strictEqual((yield* access.decide("local", localPartition))._tag, "Allow");
      const ledger = yield* fileSystem.readFileString(
        `${stateDir}/imported-cookie-partitions.json`,
      );
      assert.isTrue(ledger.includes(USER_PARTITION));
      assert.isFalse(ledger.includes(localPartition));
      assert.isFalse(ledger.includes(AGENT_PARTITION));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("treats an unreadable cookie jar and a corrupt ledger as imported", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "e6code-cookie-corrupt-",
      });
      yield* fileSystem.writeFileString(`${stateDir}/imported-cookie-partitions.json`, "{");
      const access = yield* AgentImportedCookieAccess.pipe(
        Effect.provide(accessLayer(stateDir, () => ["localhost"])),
      );
      yield* access.bindTab("tab-1", USER_PARTITION);
      assert.strictEqual((yield* access.decide("tab-1", USER_PARTITION))._tag, "NeedsApproval");

      const unreadable = yield* AgentImportedCookieAccess.pipe(
        Effect.provide(accessLayer("", () => [], [], true)),
      );
      yield* unreadable.bindTab("tab-2", USER_PARTITION);
      assert.strictEqual((yield* unreadable.decide("tab-2", USER_PARTITION))._tag, "NeedsApproval");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("treats a failed ledger write as imported", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "e6code-cookie-write-",
      });
      const access = yield* AgentImportedCookieAccess.pipe(Effect.provide(accessLayer(stateDir)));
      yield* fileSystem.makeDirectory(`${stateDir}/imported-cookie-partitions.json`);
      yield* access.recordImport(chrome);
      yield* access.bindTab("tab-1", USER_PARTITION);
      assert.strictEqual((yield* access.decide("tab-1", USER_PARTITION))._tag, "NeedsApproval");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects agent use until this process approves the bound tab", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "e6code-cookie-access-",
      });
      const access = yield* AgentImportedCookieAccess.pipe(Effect.provide(accessLayer(stateDir)));

      yield* access.recordImport(chrome);
      yield* access.recordImport({ ...chrome, partition: AGENT_PARTITION });
      yield* access.bindTab("tab-1", USER_PARTITION);

      const before = yield* access.decide("tab-1", USER_PARTITION);
      assert.strictEqual(before._tag, "NeedsApproval");
      if (before._tag === "NeedsApproval") {
        assert.strictEqual(before.browserName, "Chrome");
        assert.strictEqual(before.profileId, "work");
      }

      const unbound = yield* access.approveTab("other-tab").pipe(Effect.flip);
      assert.instanceOf(unbound, AgentImportedCookieApprovalError);

      yield* access.bindTab("agent-tab", AGENT_PARTITION);
      const agentApproval = yield* access.approveTab("agent-tab").pipe(Effect.flip);
      assert.instanceOf(agentApproval, AgentImportedCookieApprovalError);
      assert.deepStrictEqual(yield* access.decide("agent-tab", AGENT_PARTITION), {
        _tag: "Allow",
        usesImportedCookies: false,
      });

      const record = yield* access.approveTab("tab-1");
      assert.strictEqual(record.sourceName, "Chrome");
      assert.deepStrictEqual(yield* access.decide("tab-1", USER_PARTITION), {
        _tag: "Allow",
        usesImportedCookies: true,
      });

      const restarted = yield* AgentImportedCookieAccess.pipe(
        Effect.provide(accessLayer(stateDir)),
      );
      assert.strictEqual((yield* restarted.decide("tab-1", USER_PARTITION))._tag, "NeedsApproval");
      const ledger = yield* fileSystem.readFileString(
        `${stateDir}/imported-cookie-partitions.json`,
      );
      assert.isTrue(ledger.includes(USER_PARTITION));
      assert.isFalse(ledger.includes(AGENT_PARTITION));
      assert.isFalse(ledger.endsWith(".tmp"));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("approves a bound tab whose site cookies were never imported", () =>
    Effect.gen(function* () {
      const access = yield* AgentImportedCookieAccess.pipe(
        Effect.provide(accessLayer("", () => ["github.com"])),
      );
      yield* access.bindTab("tab-1", USER_PARTITION);
      const record = yield* access.approveTab("tab-1");
      assert.strictEqual(record.sourceId, "existing-session");
      assert.deepStrictEqual(yield* access.decide("tab-1", USER_PARTITION), {
        _tag: "Allow",
        usesImportedCookies: true,
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("remembers a denial for the session and allows at most one prompt per minute", () =>
    Effect.gen(function* () {
      const access = yield* AgentImportedCookieAccess.pipe(Effect.provide(accessLayer("")));
      assert.deepStrictEqual(yield* access.beginPrompt("tab-1"), { allowed: true });
      assert.deepStrictEqual(yield* access.beginPrompt("tab-1"), { allowed: false });
      assert.deepStrictEqual(yield* access.beginPrompt("tab-2"), { allowed: true });
      yield* access.finishPrompt("tab-1");
      assert.deepStrictEqual(yield* access.beginPrompt("tab-1"), { allowed: false });
      yield* TestClock.adjust(60_000);
      assert.deepStrictEqual(yield* access.beginPrompt("tab-1"), { allowed: true });
      yield* access.denyTab("tab-1");
      yield* TestClock.adjust(120_000);
      assert.deepStrictEqual(yield* access.beginPrompt("tab-1"), { allowed: false });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("drops the grant when the imported partition is forgotten", () =>
    Effect.gen(function* () {
      const access = yield* AgentImportedCookieAccess.pipe(Effect.provide(accessLayer("")));
      yield* access.recordImport(chrome);
      yield* access.bindTab("tab-1", USER_PARTITION);
      yield* access.approveTab("tab-1");
      const dropped = yield* access.forgetPartitions([USER_PARTITION]);
      assert.deepStrictEqual(dropped, ["tab-1"]);
      assert.deepStrictEqual(yield* access.decide("tab-1", USER_PARTITION), {
        _tag: "Allow",
        usesImportedCookies: false,
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("still prompts after a ledger forget when site cookies remain", () =>
    Effect.gen(function* () {
      const access = yield* AgentImportedCookieAccess.pipe(
        Effect.provide(accessLayer("", () => ["github.com"])),
      );
      yield* access.recordImport(chrome);
      yield* access.bindTab("tab-1", USER_PARTITION);
      yield* access.approveTab("tab-1");
      yield* access.forgetPartitions([USER_PARTITION]);
      assert.strictEqual((yield* access.decide("tab-1", USER_PARTITION))._tag, "NeedsApproval");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

describe("agent and server surfaces", () => {
  it("do not include an imported-cookie grant operation", () => {
    assert.notInclude(Object.keys(WS_METHODS), "preview.grantAgentImportedCookieAccess");
    assert.notInclude([...PREVIEW_AUTOMATION_OPERATIONS], "grantAgentImportedCookieAccess");
    assert.notInclude(Object.keys(WS_METHODS), "preview.approveImportedCookies");
  });
});
