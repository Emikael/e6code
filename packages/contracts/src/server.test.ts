import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import {
  resolveEnvironmentMachineKind,
  ServerConfig,
  ServerObservability,
  ServerPerformanceMetricsResult,
  ServerProvider,
  ServerProviders,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import { ServerSettings } from "./settings.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);
const decodeServerObservability = Schema.decodeUnknownSync(ServerObservability);
const decodeUpsertKeybindingResult = Schema.decodeUnknownSync(ServerUpsertKeybindingResult);
const decodeAvailableEditors = Schema.decodeUnknownSync(ServerConfig.fields.availableEditors);

const baseProviderSnapshot = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
};

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });

  it("decodes optional legacy model metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          isLegacy: true,
          capabilities: null,
        },
      ],
    });

    expect(parsed.models[0]?.isLegacy).toBe(true);
  });

  it("decodes picker metadata and reads values it cannot decode as absent", () => {
    const model = { slug: "claude-opus-5", name: "Opus 5", isCustom: false, capabilities: null };
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      models: [
        { ...model, contextWindowTokens: 1_000_000, priceTier: 3 },
        { ...model, slug: "future", contextWindowTokens: 0.5, priceTier: 4 },
        model,
      ],
    });

    expect(parsed.models[0]).toMatchObject({ contextWindowTokens: 1_000_000, priceTier: 3 });
    expect(parsed.models[1]?.contextWindowTokens).toBeUndefined();
    expect(parsed.models[1]?.priceTier).toBeUndefined();
    expect(parsed.models[2]).not.toHaveProperty("priceTier");
  });
});

describe("server config forward compatibility", () => {
  it("drops config issues with kinds this build does not know", () => {
    const parsed = decodeUpsertKeybindingResult({
      keybindings: [],
      issues: [
        { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
        { kind: "keybindings.future-issue", message: "From a newer server" },
      ],
    });

    expect(parsed.issues).toEqual([
      { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
    ]);
  });

  it("drops editor ids this build does not know", () => {
    const parsed = decodeAvailableEditors(["zed", "some-future-editor", "vscode"]);

    expect(parsed).toEqual(["zed", "vscode"]);
  });

  // A provider status this build has never seen (a new ServerProviderState,
  // ServerProviderAuthStatus, etc. member) previously failed the whole
  // `providers` array, taking every other provider down with it and, since
  // `providers` sits inside `ServerConfig`, failing the whole config decode —
  // an older client would drop its connection over one provider it can't
  // render. Dropping just that element keeps every other provider working.
  it("drops providers this build cannot decode instead of failing the whole array", () => {
    const decodedBase = decodeServerProvider(baseProviderSnapshot);

    const parsed = decodeServerProviders([
      baseProviderSnapshot,
      { ...baseProviderSnapshot, instanceId: "future", status: "some-future-status" },
    ]);

    expect(parsed).toEqual([decodedBase]);
  });

  it("drops usage windows this build cannot decode instead of failing the provider", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      usageLimits: {
        checkedAt: "2026-04-10T00:00:00.000Z",
        windows: [
          { id: "primary", kind: "session", label: "Session", usedPercent: 12 },
          { id: "future", kind: "some-future-kind", label: "Future", usedPercent: 1 },
          { id: "bad", kind: "weekly", label: "Weekly", usedPercent: 120 },
        ],
      },
    });

    expect(parsed.usageLimits?.windows).toEqual([
      { id: "primary", kind: "session", label: "Session", usedPercent: 12 },
    ]);
  });
});

describe("ServerObservability", () => {
  it("reads a server from before the log signal as exporting no logs", () => {
    const parsed = decodeServerObservability({
      logsDirectoryPath: "/tmp/e6/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "https://collector.example.com/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    });

    expect(parsed.otlpLogsEnabled).toBe(false);
    expect(parsed.otlpLogsUrl).toBeUndefined();
  });
});

describe("resolveEnvironmentMachineKind", () => {
  const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
  const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
  const descriptor = (platform: Record<string, unknown>) =>
    decodeDescriptor({
      environmentId: "env-1",
      label: "Box",
      platform: { os: "linux", arch: "x64", ...platform },
      serverVersion: "1.0.0",
      capabilities: {},
    });

  it("prefers the user's pick over what the server detected", () => {
    expect(
      resolveEnvironmentMachineKind({
        environment: descriptor({ machine: "mac-mini" }),
        settings: decodeSettings({ environmentIcon: "laptop" }),
      }),
    ).toBe("laptop");
  });

  it("uses detection when nothing is picked", () => {
    expect(
      resolveEnvironmentMachineKind({
        environment: descriptor({ machine: "mac-mini" }),
        settings: decodeSettings({}),
      }),
    ).toBe("mac-mini");
  });

  it("uses detection from a bare descriptor before connecting", () => {
    expect(resolveEnvironmentMachineKind({ environment: descriptor({ machine: "laptop" }) })).toBe(
      "laptop",
    );
  });

  it("falls back to a server for older servers and before connect", () => {
    expect(
      resolveEnvironmentMachineKind({
        environment: descriptor({}),
        settings: decodeSettings({}),
      }),
    ).toBe("server");
    expect(resolveEnvironmentMachineKind(null)).toBe("server");
  });

  it("drops a machine kind this build does not know instead of failing the descriptor", () => {
    const parsed = descriptor({ machine: "toaster" });

    expect(parsed.platform.machine).toBeUndefined();
    expect(
      resolveEnvironmentMachineKind({ environment: parsed, settings: decodeSettings({}) }),
    ).toBe("server");
  });
});

describe("ServerPerformanceMetricsResult", () => {
  const codec = Schema.toCodecJson(ServerPerformanceMetricsResult);
  const encoded = {
    readAt: "2026-11-17T12:00:10.000Z",
    startedAt: "2026-11-17T12:00:00.000Z",
    intervalMs: 10_000,
    coveredMs: 10_000,
    eventLoop: {
      _tag: "Some",
      value: {
        resolutionMs: 20,
        latest: {
          endedAt: "2026-11-17T12:00:10.000Z",
          p50Ms: 2.04,
          p99Ms: 18.67,
          maxMs: 51.43,
          utilization: 0.08,
        },
        worstP99Ms: 18.67,
        maxMs: 51.43,
        intervals: [],
      },
    },
    rpcTotals: {
      frames: 2,
      bytes: 300,
      maxFrameBytes: 200,
      p95FrameBytesAtMost: 200,
      framesOver4KiB: 0,
      framesOver256KiB: 0,
    },
    rpc: [
      {
        method: "orchestration.subscribeShell",
        chunkFrames: 1,
        chunkValues: 2,
        chunkBytes: 200,
        exitFrames: 1,
        exitBytes: 100,
        maxFrameBytes: 200,
        p95FrameBytesAtMost: 200,
        framesOver4KiB: 0,
        framesOver256KiB: 0,
      },
    ],
    sqliteTotals: {
      count: 1,
      failures: 0,
      totalMs: 0.4,
      maxMs: 0.4,
      statements: 1,
      overflowedNames: 0,
    },
    sqlite: [
      {
        name: "SELECT projection_threads#3fa2c1",
        sample: "SELECT * FROM projection_threads WHERE id = ?",
        count: 1,
        failures: 0,
        totalMs: 0.4,
        maxMs: 0.4,
        p95MsAtMost: 0.4,
      },
    ],
    shell: {
      subscribers: 1,
      maxSubscribers: 2,
      windows: 3,
      inputEvents: 40,
      liveRefetches: 4,
      catchUpRefetches: 2,
      retries: 0,
      failures: 0,
      maxRefetchesPerWindow: 2,
      p95RefetchesPerWindowAtMost: 2,
    },
  };

  it("round-trips event-loop delay through the wire encoding", () => {
    const decoded = Schema.decodeUnknownSync(codec)(encoded);
    const eventLoop = decoded.eventLoop;
    expect(eventLoop._tag).toBe("Some");
    if (eventLoop._tag === "Some") {
      expect(eventLoop.value.latest).toMatchObject({ p50Ms: 2.04, p99Ms: 18.67, maxMs: 51.43 });
    }
    expect(Schema.encodeSync(codec)(decoded)).toEqual(encoded);
  });

  it("decodes a server without event-loop samples yet", () => {
    const decoded = Schema.decodeUnknownSync(codec)({ ...encoded, eventLoop: { _tag: "None" } });
    expect(decoded.eventLoop._tag).toBe("None");
  });
});
