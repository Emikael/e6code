import { describe, expect, it } from "@effect/vitest";
import { AuthenticationError, PermissionDeniedError } from "@typesafe-ai/sdk";
import * as Effect from "effect/Effect";

import {
  JEV_MODEL_ID,
  layer,
  layerTest,
  JevEngine,
  RESULT_CACHE_MAX_ENTRIES,
  type JevBackend,
} from "./JevEngine.ts";

const stubAnswers = () => ({
  model: JEV_MODEL_ID,
  answers: {
    handling_route: {
      type: "choice",
      choice: "answer_deterministic",
      probabilities: { answer_deterministic: 0.9, full_llm: 0.1 },
      confidence: 0.85,
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
  usage: { input_tokens: 120, output_tokens: 0 },
});

const stubBackend = (): JevBackend =>
  ({
    systemOne: ((_request: unknown) => Promise.resolve(stubAnswers())) as JevBackend["systemOne"],
  }) as JevBackend;

const stubLayer = (overrides?: {
  readonly createBackend?: () => JevBackend | Promise<JevBackend>;
  readonly timeoutMs?: number;
}) =>
  layer({
    resolveApiKey: Effect.succeed("jev-test-key"),
    ...(overrides?.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
    createBackend: overrides?.createBackend ?? (() => stubBackend()),
  });

describe("JevEngine", () => {
  it.live("skips when disabled without touching the network", () =>
    Effect.gen(function* () {
      const engine = yield* JevEngine;
      expect(yield* engine.status).toEqual({ _tag: "Disabled" });
      const outcome = yield* engine.classifyTurn({ lastMessage: "hi" });
      expect(outcome).toEqual({ _tag: "Skipped", reason: "disabled" });
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("skips with zero latency when no key is stored", () =>
    Effect.gen(function* () {
      const engine = yield* JevEngine;
      expect(yield* engine.status).toEqual({ _tag: "KeyMissing" });
      const outcome = yield* engine.classifyTurn({ lastMessage: "hi" });
      expect(outcome).toEqual({ _tag: "Skipped", reason: "key-missing" });
    }).pipe(Effect.provide(layer({}))),
  );

  it.live("classifies and records the answering model", () =>
    Effect.gen(function* () {
      const engine = yield* JevEngine;
      const outcome = yield* engine.classifyTurn({ lastMessage: "hello" });
      expect(outcome._tag).toBe("Classified");
      if (outcome._tag !== "Classified") return;
      expect(outcome.route).toBe("answer_deterministic");
      expect(outcome.inputTokens).toBe(120);
      expect(outcome.model).toBe(JEV_MODEL_ID);
      expect(yield* engine.status).toEqual({ _tag: "Ready" });
      yield* engine.close;
    }).pipe(Effect.provide(stubLayer())),
  );

  it.live("treats 401 as key-invalid and recovers on success", () => {
    let calls = 0;
    const flapping = {
      systemOne: ((_request: unknown) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new AuthenticationError(401, { detail: "bad key" }, new Headers()))
          : Promise.resolve(stubAnswers());
      }) as JevBackend["systemOne"],
    } as JevBackend;
    return Effect.gen(function* () {
      const engine = yield* JevEngine;
      expect(yield* engine.classifyTurn({ lastMessage: "hello" })).toEqual({
        _tag: "Skipped",
        reason: "key-invalid",
      });
      expect(yield* engine.status).toEqual({ _tag: "KeyInvalid" });
      const recovered = yield* engine.classifyTurn({ lastMessage: "hello again" });
      expect(recovered._tag).toBe("Classified");
      expect(yield* engine.status).toEqual({ _tag: "Ready" });
    }).pipe(Effect.provide(stubLayer({ createBackend: () => flapping })));
  });

  it.live("treats 403 as key-invalid", () => {
    const denied = {
      systemOne: ((_request: unknown) =>
        Promise.reject(
          new PermissionDeniedError(403, { detail: "denied" }, new Headers()),
        )) as JevBackend["systemOne"],
    } as JevBackend;
    return Effect.gen(function* () {
      const engine = yield* JevEngine;
      expect(yield* engine.classifyTurn({ lastMessage: "hello" })).toEqual({
        _tag: "Skipped",
        reason: "key-invalid",
      });
      expect(yield* engine.status).toEqual({ _tag: "KeyInvalid" });
    }).pipe(Effect.provide(stubLayer({ createBackend: () => denied })));
  });

  it.live("fails open when the transport throws", () =>
    Effect.gen(function* () {
      const engine = yield* JevEngine;
      const outcome = yield* engine.classifyTurn({ lastMessage: "hello" });
      expect(outcome).toEqual({ _tag: "Skipped", reason: "inference-error" });
    }).pipe(
      Effect.provide(
        stubLayer({
          createBackend: () =>
            ({
              systemOne: (() => Promise.reject(new Error("boom"))) as JevBackend["systemOne"],
            }) as JevBackend,
        }),
      ),
    ),
  );

  it.live("fails open on malformed answers", () =>
    Effect.gen(function* () {
      const engine = yield* JevEngine;
      const outcome = yield* engine.classifyTurn({ lastMessage: "hello" });
      expect(outcome).toEqual({ _tag: "Skipped", reason: "inference-error" });
    }).pipe(
      Effect.provide(
        stubLayer({
          createBackend: () =>
            ({
              systemOne: (() =>
                Promise.resolve({
                  model: JEV_MODEL_ID,
                  answers: {},
                  usage: {},
                })) as JevBackend["systemOne"],
            }) as JevBackend,
        }),
      ),
    ),
  );

  it.live("fails open on timeout", () =>
    Effect.gen(function* () {
      const engine = yield* JevEngine;
      // The stubbed backend never resolves, so the timeout skip is the only
      // possible outcome: no timing flakiness by construction.
      const outcome = yield* engine.classifyTurn({ lastMessage: "slow" });
      expect(outcome).toEqual({ _tag: "Skipped", reason: "inference-timeout" });
    }).pipe(
      Effect.provide(
        stubLayer({
          timeoutMs: 50,
          createBackend: () =>
            ({
              systemOne: (() => new Promise(() => {})) as JevBackend["systemOne"],
            }) as JevBackend,
        }),
      ),
    ),
  );

  it.live("serves repeat turns from the result cache", () => {
    let inferences = 0;
    const backend = stubBackend();
    const counting = {
      systemOne: ((request: unknown) => {
        inferences += 1;
        return (backend.systemOne as (request: unknown) => Promise<unknown>)(request);
      }) as JevBackend["systemOne"],
    } as JevBackend;
    return Effect.gen(function* () {
      const engine = yield* JevEngine;
      const first = yield* engine.classifyTurn({ lastMessage: "hello" });
      const second = yield* engine.classifyTurn({ lastMessage: "hello" });
      const third = yield* engine.classifyTurn({ lastMessage: "different question" });
      expect(first._tag).toBe("Classified");
      expect(second).toMatchObject({ _tag: "Classified", route: "answer_deterministic" });
      expect(third._tag).toBe("Classified");
      expect(inferences).toBe(2);
    }).pipe(Effect.provide(stubLayer({ createBackend: () => counting })));
  });

  it.live("evicts the oldest cached answers past the limit", () => {
    let inferences = 0;
    const backend = stubBackend();
    const counting = {
      systemOne: ((request: unknown) => {
        inferences += 1;
        return (backend.systemOne as (request: unknown) => Promise<unknown>)(request);
      }) as JevBackend["systemOne"],
    } as JevBackend;
    return Effect.gen(function* () {
      const engine = yield* JevEngine;
      for (let index = 0; index <= RESULT_CACHE_MAX_ENTRIES; index += 1) {
        yield* engine.classifyTurn({ lastMessage: `question-${index}` });
      }
      expect(inferences).toBe(RESULT_CACHE_MAX_ENTRIES + 1);
      yield* engine.classifyTurn({ lastMessage: "question-0" });
      expect(inferences).toBe(RESULT_CACHE_MAX_ENTRIES + 2);
    }).pipe(Effect.provide(stubLayer({ createBackend: () => counting })));
  });
});
