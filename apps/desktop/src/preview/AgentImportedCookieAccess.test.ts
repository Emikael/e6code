import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  WS_METHODS,
} from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  AgentImportedCookieAccess,
  AgentImportedCookieApprovalError,
  decideAgentPartitionAccess,
  layer,
} from "./AgentImportedCookieAccess.ts";

const USER_PARTITION = "persist:e6code-preview-user";
const AGENT_PARTITION = "persist:e6code-preview-agent-abc";
const decodeOpen = Schema.decodeUnknownSync(PreviewAutomationOpenInput);
const decodeNavigate = Schema.decodeUnknownSync(PreviewAutomationNavigateInput);

const chrome = {
  partition: USER_PARTITION,
  sourceId: "chrome",
  sourceName: "Chrome",
  profileId: "work",
};

const accessLayer = (stateDir: string) =>
  layer.pipe(
    Layer.provide(
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        stateDir,
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
    ),
    Layer.provide(NodeServices.layer),
  );

describe("decideAgentPartitionAccess", () => {
  it("allows an agent partition even if a record names it", () => {
    assert.deepStrictEqual(
      decideAgentPartitionAccess({
        partition: AGENT_PARTITION,
        record: { ...chrome, partition: AGENT_PARTITION },
        approvedPartition: null,
      }),
      { _tag: "Allow", usesImportedCookies: false },
    );
  });

  it("allows a user partition that never received an import", () => {
    assert.deepStrictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: null,
        approvedPartition: null,
      }),
      { _tag: "Allow", usesImportedCookies: false },
    );
  });

  it("requires approval for an imported partition and allows it after", () => {
    assert.strictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: chrome,
        approvedPartition: null,
      })._tag,
      "NeedsApproval",
    );
    assert.deepStrictEqual(
      decideAgentPartitionAccess({
        partition: USER_PARTITION,
        record: chrome,
        approvedPartition: USER_PARTITION,
      }),
      { _tag: "Allow", usesImportedCookies: true },
    );
  });
});

describe("AgentImportedCookieAccess", () => {
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
});

describe("agent and server surfaces", () => {
  it("cannot grant imported-cookie access", () => {
    const surfaces = [
      ...Object.keys(WS_METHODS),
      ...Object.values(WS_METHODS),
      ...PREVIEW_AUTOMATION_OPERATIONS,
      ...Object.keys(DEFAULT_CLIENT_SETTINGS),
    ];
    for (const surface of surfaces) {
      assert.notMatch(String(surface), /importedCookie|grantAgent|agentPartition/i);
    }

    const open = decodeOpen({
      profileId: "work",
      grantAgentImportedCookieAccess: true,
    });
    assert.strictEqual("profileId" in open, false);
    assert.strictEqual("grantAgentImportedCookieAccess" in open, false);

    const navigate = decodeNavigate({
      url: "https://example.com",
      actor: "agent",
      approveImportedCookies: true,
    });
    assert.strictEqual("actor" in navigate, false);
    assert.strictEqual("approveImportedCookies" in navigate, false);
  });
});
