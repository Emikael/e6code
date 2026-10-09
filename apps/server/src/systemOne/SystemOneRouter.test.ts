import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ServerSettingsError } from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { MAX_STATE_TOKENS } from "./stateBuilder.ts";

import {
  JevEngine,
  make as makeEngine,
  layerTest as engineLayerTest,
  type JevBackend,
} from "./JevEngine.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { layer, layerTest as routerLayerTest, SystemOneRouter } from "./SystemOneRouter.ts";
import { layer as usageLayer, SystemOneUsageTracker } from "./systemOneUsageTracker.ts";

const settingsOn = ServerSettingsService.layerTest({ systemOne: { enabled: true } });

const stubBackend = (
  choice: string,
  confidence = 0.95,
  options?: { readonly localFact?: string; readonly dependsOnEarlierTurns?: number },
): JevBackend => ({
  systemOne: () =>
    Promise.resolve({
      model: "jev-1.13.0",
      answers: {
        handling_route: {
          type: "choice",
          choice,
          probabilities: { [choice]: confidence },
          confidence,
        },
        local_fact: {
          type: "choice",
          choice: options?.localFact ?? "none",
          probabilities: { [options?.localFact ?? "none"]: 0.9 },
          confidence: 0.9,
        },
        depends_on_earlier_turns: {
          type: "noul",
          noul: options?.dependsOnEarlierTurns ?? 0.05,
        },
        is_sensitive_or_risky: { type: "noul", noul: 0.05 },
      },
      usage: { input_tokens: 60, output_tokens: 0 },
    }),
});

const engineWith = (
  choice: string,
  options?: { readonly localFact?: string; readonly dependsOnEarlierTurns?: number },
) =>
  Layer.effect(
    JevEngine,
    makeEngine({
      resolveApiKey: Effect.succeed("router-test-key"),
      createBackend: () => stubBackend(choice, 0.95, options),
    }),
  );

const routeWith = (
  routerLayer: Layer.Layer<SystemOneRouter, ServerSettingsError, never>,
  text: string,
  hasAttachments = false,
  extra?: {
    readonly projectName?: string;
    readonly threadTitle?: string;
    readonly recentTurns?: string;
  },
) =>
  Effect.gen(function* () {
    const router = yield* SystemOneRouter;
    return yield* router.routeTurn({
      text,
      hasAttachments,
      ...(extra?.projectName !== undefined ? { projectName: extra.projectName } : {}),
      ...(extra?.threadTitle !== undefined ? { threadTitle: extra.threadTitle } : {}),
      ...(extra?.recentTurns !== undefined
        ? { loadRecentTurns: Effect.succeed(extra.recentTurns) }
        : {}),
    });
  }).pipe(Effect.provide(routerLayer));

describe("SystemOneRouter", () => {
  it.live("stays off when disabled", () =>
    Effect.gen(function* () {
      expect(yield* routeWith(routerLayerTest, "hello")).toEqual({
        _tag: "FullLlm",
        reason: "router-disabled-in-test",
      });
    }),
  );

  it.live("skips the engine call on attachments", () =>
    Effect.gen(function* () {
      expect(
        yield* routeWith(
          Layer.provide(layer(), Layer.mergeAll(engineLayerTest, settingsOn)),
          "see attached",
          true,
        ),
      ).toEqual({ _tag: "FullLlm", reason: "has-attachments" });
    }),
  );

  it.live("answers exact greetings without calling Jev", () => {
    let calls = 0;
    const counting = Layer.effect(
      JevEngine,
      makeEngine({
        resolveApiKey: Effect.succeed("router-test-key"),
        createBackend: () => ({
          systemOne: (request) => {
            calls += 1;
            return stubBackend("full_provider").systemOne(request);
          },
        }),
      }),
    );
    return Effect.gen(function* () {
      const router = yield* SystemOneRouter;
      const tracker = yield* SystemOneUsageTracker;
      const outcome = yield* router.routeTurn({ text: "hi", hasAttachments: false });
      expect(yield* tracker.readTotals).toMatchObject({
        calls: 0,
        deterministic: 1,
        llmCallsAvoided: 1,
        jevInputTokens: 0,
      });
      expect(outcome).toMatchObject({
        _tag: "Deterministic",
        route: "local_lookup",
        confidence: 1,
        inputTokens: 0,
        latencyMs: 0,
      });
      if (outcome._tag !== "Deterministic") return;
      expect(outcome.text).toContain("Hello!");
      expect(outcome.model).toBeUndefined();
      expect(calls).toBe(0);
    }).pipe(
      Effect.provide(Layer.provideMerge(layer(), Layer.mergeAll(counting, settingsOn, usageLayer))),
    );
  });

  it.live("answers a paraphrased lookup from the local-fact choice", () =>
    Effect.gen(function* () {
      const outcome = yield* routeWith(
        Layer.provide(
          layer(),
          Layer.mergeAll(engineWith("local_lookup", { localFact: "project_name" }), settingsOn),
        ),
        "remind me what this codebase is named",
        false,
        { projectName: "shop" },
      );
      expect(outcome).toMatchObject({
        _tag: "Deterministic",
        text: 'This project is called "shop".',
        route: "local_lookup",
        confidence: 0.95,
        inputTokens: 60,
        model: "jev-1.13.0",
      });
    }),
  );

  it.live("falls back when no template covers the turn", () =>
    Effect.gen(function* () {
      expect(
        yield* routeWith(
          Layer.provide(
            layer(),
            Layer.mergeAll(engineWith("local_lookup", { localFact: "none" }), settingsOn),
          ),
          "refactor the auth module",
        ),
      ).toMatchObject({ _tag: "FullLlm", reason: "no-deterministic-template" });
    }),
  );

  it.live("passes full-provider routes through with policy detail", () =>
    Effect.gen(function* () {
      expect(
        yield* routeWith(
          Layer.provide(layer(), Layer.mergeAll(engineWith("full_provider"), settingsOn)),
          "build it",
        ),
      ).toMatchObject({
        _tag: "FullLlm",
        reason: "full-provider",
        policyRoute: "full_provider",
      });
    }),
  );

  it.live("passes fast-path routes through with policy detail", () =>
    Effect.gen(function* () {
      const outcome = yield* routeWith(
        Layer.provide(layer(), Layer.mergeAll(engineWith("trimmed_provider"), settingsOn)),
        "summarize this",
      );
      expect(outcome._tag).toBe("FastPath");
      if (outcome._tag !== "FastPath") return;
      expect(outcome.route).toBe("trimmed_provider");
      expect(outcome.confidence).toBe(0.95);
    }),
  );

  it.live("keeps full context when the turn depends on earlier messages", () =>
    Effect.gen(function* () {
      expect(
        yield* routeWith(
          Layer.provide(
            layer(),
            Layer.mergeAll(
              engineWith("trimmed_provider", { dependsOnEarlierTurns: 0.9 }),
              settingsOn,
            ),
          ),
          "do that again",
          false,
          { recentTurns: "user: rename the button\nassistant: Renamed it." },
        ),
      ).toMatchObject({ _tag: "FullLlm", reason: "depends-on-earlier-turns" });
    }),
  );

  it.live("loads recent turns only for turns it classifies", () => {
    let loads = 0;
    const loadRecentTurns = Effect.sync(() => {
      loads += 1;
      return "user: rename the button\nassistant: Renamed it.";
    });
    const routerLayer = Layer.provide(
      layer(),
      Layer.mergeAll(engineWith("trimmed_provider"), settingsOn),
    );
    const route = (text: string, hasAttachments = false) =>
      Effect.gen(function* () {
        const router = yield* SystemOneRouter;
        return yield* router.routeTurn({ text, hasAttachments, loadRecentTurns });
      }).pipe(Effect.provide(routerLayer));
    return Effect.gen(function* () {
      expect(yield* route("hi")).toMatchObject({ _tag: "Deterministic" });
      expect(yield* route("see attached", true)).toMatchObject({ reason: "has-attachments" });
      expect(yield* route("  ")).toMatchObject({ reason: "empty-text" });
      expect(yield* route("x".repeat(MAX_STATE_TOKENS * 8))).toMatchObject({
        reason: "text-too-long",
      });
      expect(loads).toBe(0);
      expect(yield* route("summarize this")).toMatchObject({ _tag: "FastPath" });
      expect(loads).toBe(1);
    });
  });

  it.live("fails open when the engine cannot load", () =>
    Effect.gen(function* () {
      const failingEngine = Layer.effect(
        JevEngine,
        makeEngine({
          resolveApiKey: Effect.succeed("router-test-key"),
          createBackend: () => Promise.reject(new Error("no backend")),
        }),
      );
      expect(
        yield* routeWith(
          Layer.provide(layer(), Layer.mergeAll(failingEngine, settingsOn)),
          "build it",
        ),
      ).toMatchObject({ _tag: "FullLlm", reason: "jev-skipped:inference-error" });
    }),
  );

  it.live("routes likely secrets to the full LLM without uploading", () =>
    Effect.gen(function* () {
      let calls = 0;
      const counting = Layer.effect(
        JevEngine,
        makeEngine({
          resolveApiKey: Effect.succeed("router-test-key"),
          createBackend: () => ({
            systemOne: (request) => {
              calls += 1;
              return stubBackend("local_lookup", 0.95, { localFact: "greeting" }).systemOne(
                request,
              );
            },
          }),
        }),
      );
      const routerLayer = Layer.provide(layer(), Layer.mergeAll(counting, settingsOn));
      const samples = [
        "here is the deploy key: AKIAIOSFODNN7EXAMPLE for the migration",
        "stripe sk_live_exampletestfixture",
        "claude sk-ant-exampletestfixture",
        "openai sk-proj-exampletestfixture",
        "Authorization: Bearer exampletokenvalue",
        "maps AIzaExampleTestFixtureKey99ab",
        "grok xai-exampletestfixture",
      ];
      for (const text of samples) {
        expect(yield* routeWith(routerLayer, text)).toEqual({
          _tag: "FullLlm",
          reason: "key-like-material",
        });
      }
      expect(calls).toBe(0);
    }),
  );

  it.live("does not upload secrets from earlier turns", () =>
    Effect.gen(function* () {
      let calls = 0;
      const counting = Layer.effect(
        JevEngine,
        makeEngine({
          resolveApiKey: Effect.succeed("router-test-key"),
          createBackend: () => ({
            systemOne: (request) => {
              calls += 1;
              return stubBackend("trimmed_provider").systemOne(request);
            },
          }),
        }),
      );
      expect(
        yield* routeWith(
          Layer.provide(layer(), Layer.mergeAll(counting, settingsOn)),
          "thanks, what should I do next?",
          false,
          { recentTurns: "user: deploy with AKIAIOSFODNN7EXAMPLE\nassistant: Deployed." },
        ),
      ).toEqual({ _tag: "FullLlm", reason: "key-like-material" });
      expect(calls).toBe(0);
    }),
  );

  it.live("does not materialize secrets when routing is off", () => {
    let materialized = 0;
    const settingsLayer = Layer.succeed(
      ServerSettingsService,
      ServerSettingsService.of({
        start: Effect.void,
        ready: Effect.void,
        getPersistedSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        getSettings: Effect.sync(() => {
          materialized += 1;
          return DEFAULT_SERVER_SETTINGS;
        }),
        updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
        streamChanges: Stream.empty,
        subscribeChanges: Effect.succeed(Stream.empty),
      }),
    );
    return Effect.gen(function* () {
      expect(
        yield* routeWith(
          Layer.provide(layer(), Layer.mergeAll(engineLayerTest, settingsLayer)),
          "hi",
        ),
      ).toEqual({ _tag: "FullLlm", reason: "router-disabled" });
      expect(materialized).toBe(0);
    });
  });

  it.live("does not count skipped engine calls as Jev usage", () =>
    Effect.gen(function* () {
      const router = yield* SystemOneRouter;
      const tracker = yield* SystemOneUsageTracker;
      expect(
        yield* router.routeTurn({ text: "refactor the auth module", hasAttachments: false }),
      ).toMatchObject({
        _tag: "FullLlm",
        reason: "jev-skipped:disabled",
      });
      expect(yield* tracker.readTotals).toMatchObject({ calls: 0, fallback: 0 });
    }).pipe(
      Effect.provide(
        Layer.provideMerge(layer(), Layer.mergeAll(engineLayerTest, settingsOn, usageLayer)),
      ),
    ),
  );

  it.live("bypasses classification when the request would be truncated", () => {
    let calls = 0;
    const engine = Layer.succeed(
      JevEngine,
      JevEngine.of({
        status: Effect.succeed({ _tag: "Ready" }),
        close: Effect.void,
        classifyTurn: () =>
          Effect.sync(() => {
            calls += 1;
            return { _tag: "Skipped", reason: "inference-error" };
          }),
      }),
    );
    return Effect.gen(function* () {
      const text =
        "Explain this code.\n" + "x".repeat(MAX_STATE_TOKENS * 4) + "\nDo not modify files.";
      expect(
        yield* routeWith(Layer.provide(layer(), Layer.mergeAll(engine, settingsOn)), text),
      ).toEqual({ _tag: "FullLlm", reason: "text-too-long" });
      expect(calls).toBe(0);
    });
  });

  it.live("carries the answering model on routed outcomes", () =>
    Effect.gen(function* () {
      const outcome = yield* routeWith(
        Layer.provide(
          layer(),
          Layer.mergeAll(engineWith("local_lookup", { localFact: "greeting" }), settingsOn),
        ),
        "howdy",
      );
      expect(outcome._tag).toBe("Deterministic");
      if (outcome._tag !== "Deterministic") return;
      expect(outcome.model).toBe("jev-1.13.0");
      expect(outcome.inputTokens).toBe(60);
    }),
  );
});
