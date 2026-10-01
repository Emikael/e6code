import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ServerSettingsError } from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

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

const stubBackend = (choice: string, confidence = 0.95): JevBackend => ({
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
        complexity: {
          type: "score",
          score: 0.2,
          legend: { 0: "simple" },
          probabilities: { 0: 0.9 },
          confidence: 0.9,
        },
        is_self_contained: { type: "noul", noul: 0.95 },
        is_sensitive_or_risky: { type: "noul", noul: 0.05 },
      },
      usage: { input_tokens: 60, output_tokens: 0 },
    }),
});

const engineWith = (choice: string) =>
  Layer.effect(
    JevEngine,
    makeEngine({
      resolveApiKey: Effect.succeed("router-test-key"),
      createBackend: () => stubBackend(choice),
    }),
  );

const routeWith = (
  routerLayer: Layer.Layer<SystemOneRouter, ServerSettingsError, never>,
  text: string,
  hasAttachments = false,
) =>
  Effect.gen(function* () {
    const router = yield* SystemOneRouter;
    return yield* router.routeTurn({ text, hasAttachments });
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

  it.live("answers deterministically from templates", () =>
    Effect.gen(function* () {
      const outcome = yield* routeWith(
        Layer.provide(layer(), Layer.mergeAll(engineWith("answer_deterministic"), settingsOn)),
        "hi",
      );
      expect(outcome._tag).toBe("Deterministic");
      if (outcome._tag !== "Deterministic") return;
      expect(outcome.text).toContain("Hello!");
      expect(outcome.confidence).toBe(0.95);
    }),
  );

  it.live("falls back when no template covers the turn", () =>
    Effect.gen(function* () {
      expect(
        yield* routeWith(
          Layer.provide(layer(), Layer.mergeAll(engineWith("answer_deterministic"), settingsOn)),
          "refactor the auth module",
        ),
      ).toMatchObject({ _tag: "FullLlm", reason: "no-deterministic-template" });
    }),
  );

  it.live("passes full-model routes through with policy detail", () =>
    Effect.gen(function* () {
      expect(
        yield* routeWith(
          Layer.provide(layer(), Layer.mergeAll(engineWith("full_llm"), settingsOn)),
          "build it",
        ),
      ).toMatchObject({ _tag: "FullLlm", reason: "full-model-requested", policyRoute: "full_llm" });
    }),
  );

  it.live("passes fast-path routes through with policy detail", () =>
    Effect.gen(function* () {
      const outcome = yield* routeWith(
        Layer.provide(layer(), Layer.mergeAll(engineWith("fast_llm_trimmed"), settingsOn)),
        "summarize this",
      );
      expect(outcome._tag).toBe("FastPath");
      if (outcome._tag !== "FastPath") return;
      expect(outcome.route).toBe("fast_llm_trimmed");
      expect(outcome.confidence).toBe(0.95);
    }),
  );

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
        yield* routeWith(Layer.provide(layer(), Layer.mergeAll(failingEngine, settingsOn)), "hi"),
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
              return stubBackend("answer_deterministic").systemOne(request);
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
      expect(yield* router.routeTurn({ text: "hi", hasAttachments: false })).toMatchObject({
        _tag: "FullLlm",
        reason: "jev-skipped:disabled",
      });
      expect(yield* tracker.readTotals).toMatchObject({ calls: 0, fallback: 0 });
    }).pipe(
      Effect.provide(
        Layer.provide(layer(), Layer.mergeAll(engineLayerTest, settingsOn, usageLayer)),
      ),
    ),
  );

  it.live("carries the answering model on routed outcomes", () =>
    Effect.gen(function* () {
      const outcome = yield* routeWith(
        Layer.provide(layer(), Layer.mergeAll(engineWith("answer_deterministic"), settingsOn)),
        "hi",
      );
      expect(outcome._tag).toBe("Deterministic");
      if (outcome._tag !== "Deterministic") return;
      expect(outcome.model).toBe("jev-1.13.0");
      expect(outcome.inputTokens).toBe(60);
    }),
  );
});
