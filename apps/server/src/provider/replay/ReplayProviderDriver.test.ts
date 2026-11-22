import {
  CursorSettings,
  DEFAULT_MODEL_BY_PROVIDER,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ServerProvider,
  ThreadId,
} from "@e6tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { CursorDriver } from "../Drivers/CursorDriver.ts";
import { contractRecording } from "../testUtils/replayRecordings.ts";
import { makeReplayProviderDriver } from "./ReplayProviderDriver.ts";
import type { ReplayProviderAdapterOptions } from "./ReplayProviderAdapter.ts";

const cursor = ProviderDriverKind.make("cursor");
const decodeCursorSettings = Schema.decodeUnknownEffect(CursorSettings);
const encodeServerProvider = Schema.encodeEffect(ServerProvider);
const decodeServerProvider = Schema.decodeUnknownEffect(ServerProvider);
const instanceId = ProviderInstanceId.make("cursor");
const modelSelection = { instanceId, model: "auto" };

const createInstance = (
  options: Omit<ReplayProviderAdapterOptions, "recording"> & { readonly enabled?: boolean },
) => {
  const { enabled = true, ...replay } = options;
  const driver = makeReplayProviderDriver({
    driver: CursorDriver,
    recording: contractRecording(cursor, "plain"),
    options: replay,
  });
  return driver.create({
    instanceId,
    displayName: undefined,
    environment: [],
    enabled,
    config: driver.defaultConfig(),
  });
};

describe("ReplayProviderDriver", () => {
  it.effect("keeps the replaced driver's identity and settings handling", () =>
    Effect.gen(function* () {
      const driver = makeReplayProviderDriver({
        driver: CursorDriver,
        recording: contractRecording(cursor, "plain"),
        options: {},
      });
      expect(driver.driverKind).toBe(cursor);
      expect(driver.metadata).toEqual(CursorDriver.metadata);
      const legacy = { enabled: true, binaryPath: "/opt/cursor/agent", customModels: [] };
      const decodeReplayConfig = Schema.decodeUnknownEffect(driver.configSchema);
      expect(yield* decodeReplayConfig(legacy)).toEqual(yield* decodeCursorSettings(legacy));
      expect(driver.defaultConfig()).toEqual(CursorDriver.defaultConfig());
    }),
  );

  it.effect("reports a ready, authenticated provider without probing anything", () =>
    Effect.gen(function* () {
      const instance = yield* createInstance({ speed: "instant" });
      const snapshot = yield* instance.snapshot.getSnapshot;

      // The snapshot survives the wire: it encodes and decodes as a ServerProvider.
      const roundTrip = yield* decodeServerProvider(yield* encodeServerProvider(snapshot));
      expect(roundTrip).toEqual(snapshot);
      expect(snapshot).toMatchObject({
        instanceId,
        driver: cursor,
        enabled: true,
        installed: true,
        version: "replay",
        status: "ready",
        auth: { status: "authenticated" },
        supportsConversationRollback: false,
      });
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        DEFAULT_MODEL_BY_PROVIDER[cursor],
      ]);
      expect(yield* instance.snapshot.refresh).toEqual(snapshot);
      expect(instance.driverKind).toBe(cursor);
      expect(instance.continuationIdentity.driverKind).toBe(cursor);

      const disabled = yield* createInstance({ speed: "instant", enabled: false });
      expect((yield* disabled.snapshot.getSnapshot).status).toBe("disabled");
    }),
  );

  it.effect("plays the recording through the instance's adapter", () =>
    Effect.gen(function* () {
      const instance = yield* createInstance({ speed: "instant" });
      const adapter = instance.adapter;
      const subscription = yield* adapter.subscribeRuntimeEvents;
      const delivered = yield* Queue.unbounded<ProviderRuntimeEvent>();
      yield* subscription.events.pipe(
        Stream.runForEach(({ event }) => Queue.offer(delivered, event)),
        Effect.forkScoped,
      );
      const threadId = ThreadId.make("replay-driver-thread");
      yield* adapter.startSession({ threadId, provider: cursor, runtimeMode: "full-access" });
      const turn = yield* adapter.sendTurn({ threadId, input: "Go." });

      const types: Array<string> = [];
      while (true) {
        const event = yield* Queue.take(delivered);
        expect(event.threadId).toBe(threadId);
        types.push(event.type);
        if (event.type === "turn.completed" && event.turnId === turn.turnId) break;
      }
      expect(types).toEqual([
        "session.started",
        "turn.started",
        "content.delta",
        "content.delta",
        "item.completed",
        "turn.completed",
      ]);
    }),
  );

  it.effect("answers text generation with deterministic stubs", () =>
    Effect.gen(function* () {
      const { textGeneration } = yield* createInstance({ speed: "instant" });
      const commit = yield* textGeneration.generateCommitMessage({
        cwd: "/repo",
        branch: "main",
        stagedSummary: "M src/a.ts",
        stagedPatch: "",
        includeBranch: true,
        modelSelection,
      });
      expect(commit.subject.length).toBeGreaterThan(0);
      expect(commit.branch?.length).toBeGreaterThan(0);
      const pr = yield* textGeneration.generatePrContent({
        cwd: "/repo",
        baseBranch: "main",
        headBranch: "feature",
        commitSummary: "",
        diffSummary: "",
        diffPatch: "",
        modelSelection,
      });
      expect(pr.title.length).toBeGreaterThan(0);
      const branch = yield* textGeneration.generateBranchName({
        cwd: "/repo",
        message: "Fix the parser",
        modelSelection,
      });
      expect(branch.branch.length).toBeGreaterThan(0);
      const input = { cwd: "/repo", message: "Explain the streaming budget", modelSelection };
      const title = yield* textGeneration.generateThreadTitle(input);
      expect(title.title.length).toBeGreaterThan(0);
      expect(yield* textGeneration.generateThreadTitle(input)).toEqual(title);
    }),
  );

  it.effect("stops playback when the instance scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const instance = yield* createInstance({ speed: 1 }).pipe(Scope.provide(scope));
      const adapter = instance.adapter;
      const threadId = ThreadId.make("closing-thread");
      yield* adapter.startSession({ threadId, provider: cursor, runtimeMode: "full-access" });
      yield* adapter.sendTurn({ threadId, input: "Go." });
      // Nothing has played yet: the session's first event is 80 ms in.
      expect(yield* adapter.runtimeEventSequence).toBe(0);

      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("10 seconds");

      expect(yield* adapter.runtimeEventSequence).toBe(0);
    }),
  );
});
