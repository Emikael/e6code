import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import {
  AGENT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_PROFILE_ID,
  INCOGNITO_BROWSER_PROFILE_ID,
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewAutomationStatus,
  WS_METHODS,
} from "@e6tools/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as AgentImportedCookieAccess from "../../preview/AgentImportedCookieAccess.ts";
import { isMainWindowGrantSender } from "../../preview/mainWindowGrantSender.ts";
import * as PreviewManager from "../../preview/Manager.ts";
import * as BrowserImport from "../../preview/BrowserImport/BrowserImport.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as PreviewIpc from "./preview.ts";

class PreviewIpcInvokeError extends Data.TaggedError("PreviewIpcInvokeError")<{
  readonly cause: unknown;
}> {}

const { fromPartition } = vi.hoisted(() => ({
  fromPartition: vi.fn(() => {
    throw new Error("Session can only be received when app is ready");
  }),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  session: {
    fromPartition,
  },
  webContents: {
    fromId: vi.fn(() => null),
  },
}));

describe("preview IPC methods", () => {
  beforeEach(() => {
    fromPartition.mockClear();
  });

  it("does not access the Electron session while the module loads", async () => {
    await expect(import("./preview.ts")).resolves.toBeDefined();
    expect(fromPartition).not.toHaveBeenCalled();
  });

  it("derives distinct partition scopes when identifiers contain the delimiter", () => {
    const first = PreviewIpc.resolvePartitionScope("a", "b::c");
    const second = PreviewIpc.resolvePartitionScope("a::b", "c");

    expect(first).toEqual({ scope: '["a","b::c"]', persistent: true, namespace: "profile" });
    expect(second).toEqual({ scope: '["a::b","c"]', persistent: true, namespace: "profile" });
    expect(first.scope).not.toBe(second.scope);
  });

  it("preserves lone surrogates without collapsing them to replacement characters", () => {
    const highSurrogate = PreviewIpc.resolvePartitionScope("environment", "profile-\ud800");
    const lowSurrogate = PreviewIpc.resolvePartitionScope("environment", "profile-\udc00");
    const replacement = PreviewIpc.resolvePartitionScope("environment", "profile-�");

    expect(highSurrogate.scope).toBe('["environment","profile-\\ud800"]');
    expect(lowSurrogate.scope).toBe('["environment","profile-\\udc00"]');
    expect(highSurrogate.scope).not.toBe(lowSurrogate.scope);
    expect(highSurrogate.scope).not.toBe(replacement.scope);
    expect(lowSurrogate.scope).not.toBe(replacement.scope);
  });

  it("keeps the legacy default partition scope and incognito persistence", () => {
    expect(PreviewIpc.resolvePartitionScope("environment::legacy", undefined)).toEqual({
      scope: "environment::legacy",
      persistent: true,
    });
    expect(
      PreviewIpc.resolvePartitionScope("environment::legacy", DEFAULT_BROWSER_PROFILE_ID),
    ).toEqual({ scope: "environment::legacy", persistent: true });
    expect(
      PreviewIpc.resolvePartitionScope("environment::legacy", INCOGNITO_BROWSER_PROFILE_ID),
    ).toEqual({
      scope: '["environment::legacy","incognito"]',
      persistent: false,
      namespace: "profile",
    });
    expect(PreviewIpc.resolvePartitionScope("environment", AGENT_BROWSER_PROFILE_ID)).toEqual({
      scope: "agent:environment",
      persistent: true,
      namespace: "agent",
    });
  });

  effectIt.effect("refuses to import cookies into the agent profile", () => {
    const importCookies = vi.fn(() => Effect.die("importCookies must not run"));
    const browserImport = BrowserImport.BrowserImport.of({
      listSources: Effect.succeed([]),
      importCookies,
    });
    const manager = PreviewManager.PreviewManager.of({
      getBrowserPartition: () => Effect.die("getBrowserPartition must not run"),
    } as unknown as PreviewManager.PreviewManager["Service"]);
    const access = AgentImportedCookieAccess.AgentImportedCookieAccess.of({
      recordImport: () => Effect.die("recordImport must not run"),
      approveTab: () => Effect.die("approveTab must not run"),
      forgetPartitions: () => Effect.die("forgetPartitions must not run"),
      bindTab: () => Effect.die("bindTab must not run"),
      unbindTab: () => Effect.die("unbindTab must not run"),
      partitionForTab: () => Effect.die("partitionForTab must not run"),
      describe: () => Effect.die("describe must not run"),
      decide: () => Effect.die("decide must not run"),
      revokeTab: () => Effect.die("revokeTab must not run"),
      beginPrompt: () => Effect.die("beginPrompt must not run"),
      finishPrompt: () => Effect.die("finishPrompt must not run"),
      denyTab: () => Effect.die("denyTab must not run"),
    });
    const isImportFailed = Schema.is(BrowserImport.BrowserImportFailedError);
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(
        PreviewIpc.importBrowserCookies.handler({
          environmentId: "env",
          sourceId: "helium",
          sourceProfileDirectory: "Default",
          targetProfileId: AGENT_BROWSER_PROFILE_ID,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        expect(isImportFailed(error)).toBe(true);
        if (isImportFailed(error)) expect(error.reason).toBe("agentPartition");
      }
      expect(importCookies).not.toHaveBeenCalled();
    }).pipe(
      Effect.provideService(BrowserImport.BrowserImport, browserImport),
      Effect.provideService(PreviewManager.PreviewManager, manager),
      Effect.provideService(AgentImportedCookieAccess.AgentImportedCookieAccess, access),
    );
  });

  effectIt.effect("records a successful import without approving agent use", () => {
    const events: Array<string> = [];
    const browserImport = BrowserImport.BrowserImport.of({
      listSources: Effect.succeed([]),
      importCookies: () => Effect.succeed({ imported: 2, skipped: 0, skippedDomains: [] }),
    });
    const manager = PreviewManager.PreviewManager.of({
      getBrowserPartition: () => Effect.succeed("persist:e6code-preview-user"),
    } as unknown as PreviewManager.PreviewManager["Service"]);
    const access = AgentImportedCookieAccess.AgentImportedCookieAccess.of({
      recordImport: (entry) =>
        Effect.sync(() => {
          events.push(`record:${entry.partition}:${entry.profileId}`);
        }),
      approveTab: () =>
        Effect.sync(() => {
          events.push("approve");
          return {
            partition: "persist:e6code-preview-user",
            sourceId: "helium",
            sourceName: "Helium",
            profileId: "work",
          };
        }),
      forgetPartitions: () => Effect.die("forgetPartitions must not run"),
      bindTab: () => Effect.die("bindTab must not run"),
      unbindTab: () => Effect.die("unbindTab must not run"),
      partitionForTab: () => Effect.die("partitionForTab must not run"),
      describe: () => Effect.die("describe must not run"),
      decide: () => Effect.die("decide must not run"),
      revokeTab: () => Effect.die("revokeTab must not run"),
      beginPrompt: () => Effect.die("beginPrompt must not run"),
      finishPrompt: () => Effect.die("finishPrompt must not run"),
      denyTab: () => Effect.die("denyTab must not run"),
    });
    return Effect.gen(function* () {
      const result = yield* PreviewIpc.importBrowserCookies.handler({
        environmentId: "env",
        sourceId: "helium",
        sourceProfileDirectory: "Default",
        targetProfileId: "work",
      });
      expect(result).toMatchObject({ imported: 2 });
      expect(events).toEqual(["record:persist:e6code-preview-user:work"]);
    }).pipe(
      Effect.provideService(BrowserImport.BrowserImport, browserImport),
      Effect.provideService(PreviewManager.PreviewManager, manager),
      Effect.provideService(AgentImportedCookieAccess.AgentImportedCookieAccess, access),
    );
  });

  effectIt.effect("targets imports at the same partition tuple as the renderer", () => {
    const received: Array<Parameters<BrowserImport.BrowserImport["Service"]["importCookies"]>[0]> =
      [];
    const browserImport = BrowserImport.BrowserImport.of({
      listSources: Effect.succeed([]),
      importCookies: (input) =>
        Effect.sync(() => {
          received.push(input);
          return { imported: 0, skipped: 0, skippedDomains: [] };
        }),
    });
    const request = (environmentId: string, targetProfileId: string) =>
      PreviewIpc.importBrowserCookies.handler({
        environmentId,
        sourceId: "helium",
        sourceProfileDirectory: "Default",
        targetProfileId,
      });

    const manager = PreviewManager.PreviewManager.of({
      getBrowserPartition: () => Effect.die("getBrowserPartition must not run"),
    } as unknown as PreviewManager.PreviewManager["Service"]);
    const access = AgentImportedCookieAccess.AgentImportedCookieAccess.of({
      recordImport: () => Effect.die("recordImport must not run"),
      approveTab: () => Effect.die("approveTab must not run"),
      forgetPartitions: () => Effect.die("forgetPartitions must not run"),
      bindTab: () => Effect.die("bindTab must not run"),
      unbindTab: () => Effect.die("unbindTab must not run"),
      partitionForTab: () => Effect.die("partitionForTab must not run"),
      describe: () => Effect.die("describe must not run"),
      decide: () => Effect.die("decide must not run"),
      revokeTab: () => Effect.die("revokeTab must not run"),
      beginPrompt: () => Effect.die("beginPrompt must not run"),
      finishPrompt: () => Effect.die("finishPrompt must not run"),
      denyTab: () => Effect.die("denyTab must not run"),
    });

    return Effect.gen(function* () {
      yield* request("a", "b");
      yield* request("a::b", DEFAULT_BROWSER_PROFILE_ID);

      expect(received[0]).toMatchObject(PreviewIpc.resolvePartitionScope("a", "b"));
      expect(received[1]).toMatchObject(
        PreviewIpc.resolvePartitionScope("a::b", DEFAULT_BROWSER_PROFILE_ID),
      );
      expect(received[0]?.namespace).toBe("profile");
      expect(received[1]?.namespace).toBeUndefined();
    }).pipe(
      Effect.provideService(BrowserImport.BrowserImport, browserImport),
      Effect.provideService(PreviewManager.PreviewManager, manager),
      Effect.provideService(AgentImportedCookieAccess.AgentImportedCookieAccess, access),
    );
  });

  effectIt.effect("rejects invalid webContents ids before resolving the preview service", () =>
    Effect.map(
      PreviewIpc.registerWebview
        .handler({ tabId: "tab-1", webContentsId: 0 })
        .pipe(Effect.provideService(PreviewManager.PreviewManager, null as never), Effect.exit),
      (exit) => {
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return;
        const error = Cause.findErrorOption(exit.cause);
        expect(Option.isSome(error) && Schema.isSchemaError(error.value)).toBe(true);
        expect(fromPartition).not.toHaveBeenCalled();
      },
    ),
  );

  effectIt.effect("returns automation status for long runtime tab ids", () =>
    Effect.gen(function* () {
      const tabId =
        `["environment-1","thread:delegated-task:${"a".repeat(120)}",` +
        `"server-epoch-1","preview-1"]`;
      const status = {
        available: false,
        visible: true,
        tabId,
        url: null,
        title: null,
        loading: false,
      };
      const manager = PreviewManager.PreviewManager.of({
        automationStatus: () => Effect.succeed(status),
      } as unknown as PreviewManager.PreviewManager["Service"]);

      expect(tabId.length).toBeGreaterThan(128);
      expect(
        yield* PreviewIpc.automationStatus
          .handler({ tabId })
          .pipe(Effect.provideService(PreviewManager.PreviewManager, manager)),
      ).toEqual(status);
    }),
  );

  effectIt.effect("rejects imported-cookie grant IPC from a preview guest", () =>
    Effect.gen(function* () {
      let listener: DesktopIpc.DesktopIpcHandleListener | undefined;
      let granted = false;
      const ipc = DesktopIpc.make({
        removeHandler: vi.fn(),
        handle: (_channel, registered) => {
          listener = registered;
        },
        removeAllListeners: vi.fn(),
        on: vi.fn(),
      });
      const main = {
        id: 1,
        getType: () => "window",
        mainFrame: { frameTreeNodeId: 10 },
      };
      const manager = PreviewManager.PreviewManager.of({
        acceptsImportedCookieGrantSender: (event?: DesktopIpc.DesktopIpcInvokeEvent) =>
          Effect.succeed(isMainWindowGrantSender(event, main)),
        grantAgentImportedCookieAccess: () =>
          Effect.sync(() => {
            granted = true;
          }),
      } as unknown as PreviewManager.PreviewManager["Service"]);

      yield* Effect.scoped(ipc.handle(PreviewIpc.grantAgentImportedCookieAccess)).pipe(
        Effect.provideService(PreviewManager.PreviewManager, manager),
      );
      expect(listener).toBeTypeOf("function");

      const invoke = (event: DesktopIpc.DesktopIpcInvokeEvent) =>
        Effect.tryPromise({
          try: () => Promise.resolve(listener!(event, { tabId: "tab-1" })),
          catch: (cause) => new PreviewIpcInvokeError({ cause }),
        });
      const guest = yield* Effect.exit(
        invoke({
          sender: { id: 99, getType: () => "webview" },
          senderFrame: { frameTreeNodeId: 10 },
        }),
      );
      const subframe = yield* Effect.exit(
        invoke({
          sender: { id: 1, getType: () => "window" },
          senderFrame: { frameTreeNodeId: 99 },
        }),
      );
      expect(Exit.isFailure(guest)).toBe(true);
      expect(Exit.isFailure(subframe)).toBe(true);
      expect(granted).toBe(false);

      yield* invoke({
        sender: { id: 1, getType: () => "window" },
        senderFrame: { frameTreeNodeId: 10 },
      });
      expect(granted).toBe(true);

      const preload = yield* Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = yield* path.fromFileUrl(
          new URL("../../preview/PickPreload.ts", import.meta.url),
        );
        return yield* fileSystem.readFileString(file);
      }).pipe(Effect.provide(NodeServices.layer));
      expect(preload).not.toContain("grantAgentImportedCookieAccess");
      expect(preload).not.toContain("desktop:preview-grant-agent-cookie-access");
      expect(Object.keys(WS_METHODS)).not.toContain("preview.grantAgentImportedCookieAccess");
      expect([...PREVIEW_AUTOMATION_OPERATIONS]).not.toContain("grantAgentImportedCookieAccess");
    }),
  );

  it("keeps the public automation status tab id limit", () => {
    const encode = Schema.encodeUnknownSync(PreviewAutomationStatus);
    const tabId = "t".repeat(129);

    expect(() =>
      encode({
        available: false,
        visible: true,
        tabId,
        url: null,
        title: null,
        loading: false,
      }),
    ).toThrow();
  });
});
