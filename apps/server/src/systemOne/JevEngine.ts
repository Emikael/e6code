/**
 * JevEngine - hosted Jev (System One) judgments behind a fail-open gate.
 *
 * Classifies a turn through the TypeSafe API when enabled with a key, logs
 * the decision, and skips (never throws) in every other case — disabled,
 * missing or invalid key, transport error, or timeout.
 *
 * Repeat turns hit a small LRU over past answers and skip the network call
 * entirely. The outer timeout owns the latency budget; SDK retries stay off
 * so a slow call fails open instead of compounding.
 *
 * @module JevEngine
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import {
  AuthenticationError,
  choice,
  noul,
  PermissionDeniedError,
  score,
  TypeSafeClient,
  type Questions,
  type SystemOneRequest,
} from "@typesafe-ai/sdk";

import { buildClassifyState, buildRouteQuestions, type TurnClassifyInput } from "./stateBuilder.ts";

/** Pinned model: thresholds are calibrated against a fixed version, never the alias. */
export const JEV_MODEL_ID = "jev-1.13.0";
/** A Jev call must never stall a turn past this budget; calibration tunes it. */
const DEFAULT_CLASSIFY_TIMEOUT_MS = 3000;
/** Past answers kept; repeats skip the network call entirely. */
export const RESULT_CACHE_MAX_ENTRIES = 200;

export type EngineStatus =
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "KeyMissing" }
  | { readonly _tag: "KeyInvalid" }
  | { readonly _tag: "Ready" };

export type SkipReason =
  | "disabled"
  | "key-missing"
  | "key-invalid"
  | "inference-error"
  | "inference-timeout";

export interface ClassifiedTurn {
  readonly _tag: "Classified";
  readonly route: string;
  readonly routeConfidence: number;
  readonly complexityScore: number;
  readonly selfContained: number;
  readonly sensitive: number;
  readonly latencyMs: number;
  readonly inputTokens: number;
  /** Versioned model ID that answered, for calibration logs. */
  readonly model: string;
}

export interface SkippedTurn {
  readonly _tag: "Skipped";
  readonly reason: SkipReason;
}

export type ClassifyOutcome = ClassifiedTurn | SkippedTurn;

type JevAnswerSet = {
  readonly model?: unknown;
  readonly answers?: unknown;
  readonly usage?: { readonly input_tokens?: unknown };
};

/** Structural backend so tests can inject a stub without the network. */
export type JevBackend = {
  readonly systemOne: (request: unknown) => PromiseLike<JevAnswerSet>;
};

export interface JevEngineOptions {
  /**
   * Resolves the Jev API key from the secret store. Null means no key is
   * stored: the turn skips Jev with zero added latency. The engine never
   * reads settings JSON; key material stays in the store.
   */
  readonly resolveApiKey?: Effect.Effect<string | null, never, never>;
  readonly timeoutMs?: number;
  readonly createBackend?: (apiKey: string) => JevBackend | Promise<JevBackend>;
}

/** Answers minus latency, the shape the result cache holds. */
interface CachedClassification {
  readonly route: string;
  readonly routeConfidence: number;
  readonly complexityScore: number;
  readonly selfContained: number;
  readonly sensitive: number;
  readonly inputTokens: number;
  readonly model: string;
}

/** Maps a Jev answer set onto a classified turn, throwing on malformed answers. */
function toClassified(result: JevAnswerSet): CachedClassification {
  const answers = result.answers as Record<
    string,
    | {
        readonly choice?: unknown;
        readonly confidence?: unknown;
        readonly score?: unknown;
        readonly noul?: unknown;
      }
    | undefined
  >;
  const route = answers["handling_route"];
  const complexity = answers["complexity"];
  const selfContained = answers["is_self_contained"];
  const sensitive = answers["is_sensitive_or_risky"];
  if (
    typeof route?.choice !== "string" ||
    typeof route.confidence !== "number" ||
    typeof complexity?.score !== "number" ||
    typeof selfContained?.noul !== "number" ||
    typeof sensitive?.noul !== "number" ||
    typeof result.usage?.input_tokens !== "number" ||
    typeof result.model !== "string"
  ) {
    throw new Error("Malformed Jev answers");
  }
  return {
    route: route.choice,
    routeConfidence: route.confidence,
    complexityScore: complexity.score,
    selfContained: selfContained.noul,
    sensitive: sensitive.noul,
    inputTokens: result.usage.input_tokens,
    model: result.model,
  };
}

const isAuthFailure = (error: unknown): boolean => {
  // Single-arg tryPromise wraps rejections in UnknownError with the original
  // as `cause`; inspect both layers. Unauthenticated calls surface as 401
  // (AuthenticationError) or 403 (PermissionDeniedError): the stored key
  // cannot authorize.
  const candidates: ReadonlyArray<unknown> =
    error !== null && typeof error === "object" && "cause" in error
      ? [error, (error as { readonly cause?: unknown }).cause]
      : [error];
  return candidates.some(
    (cause) =>
      cause instanceof AuthenticationError ||
      cause instanceof PermissionDeniedError ||
      (typeof cause === "object" &&
        cause !== null &&
        ((cause as { readonly status?: unknown }).status === 401 ||
          (cause as { readonly status?: unknown }).status === 403)),
  );
};

/** Skipped outcomes carry no payload, so a constructor beats a cast at every return. */
const skipped = (reason: SkipReason): SkippedTurn => ({ _tag: "Skipped", reason });

export class JevEngine extends Context.Service<
  JevEngine,
  {
    readonly status: Effect.Effect<EngineStatus>;
    /** Never fails: every failure mode becomes a Skipped outcome. */
    readonly classifyTurn: (
      input: TurnClassifyInput,
      timeoutMs?: number,
    ) => Effect.Effect<ClassifyOutcome>;
    readonly close: Effect.Effect<void>;
  }
>()("e6/systemOne/JevEngine") {}

export const make = Effect.fn("JevEngine.make")(function* (options: JevEngineOptions) {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_CLASSIFY_TIMEOUT_MS;
  const invalidKey = yield* Ref.make<string | null>(null);
  const resolveKey: Effect.Effect<string | null, never, never> =
    options.resolveApiKey ?? Effect.succeed(null);
  let backend: JevBackend | null = null;
  let backendKey: string | null = null;
  const createBackend =
    options.createBackend ??
    ((apiKey: string): JevBackend => {
      const client = new TypeSafeClient({ apiKey, retry: { maxRetries: 0 } });
      return {
        systemOne: (request) => client.systemOne(request as SystemOneRequest<Questions>),
      };
    });

  const loadBackend = Effect.fn("JevEngine.loadBackend")(function* (apiKey: string) {
    if (backend !== null && backendKey === apiKey) return backend;
    const instance: JevBackend | null = yield* Effect.tryPromise(async () =>
      createBackend(apiKey),
    ).pipe(Effect.catch(() => Effect.succeed(null)));
    if (instance === null) return null;
    backend = instance;
    backendKey = apiKey;
    return instance;
  });

  const resultCache = new Map<string, CachedClassification>();

  /** Cache key: the v1 question set is fixed, so the packed state suffices. */
  const cacheKeyFor = (state: Record<string, unknown>): string =>
    [
      `${state["lastMessage"] ?? ""}`,
      `${state["threadTitle"] ?? ""}`,
      `${state["projectName"] ?? ""}`,
      `${state["turnIndex"] ?? ""}`,
    ].join("\n");

  const status: Effect.Effect<EngineStatus> = Effect.gen(function* () {
    const apiKey = yield* resolveKey;
    if (apiKey === null) return { _tag: "KeyMissing" } as EngineStatus;
    if ((yield* Ref.get(invalidKey)) === apiKey) {
      return { _tag: "KeyInvalid" } as EngineStatus;
    }
    return { _tag: "Ready" } as EngineStatus;
  });

  const classifyTurn = Effect.fn("JevEngine.classifyTurn")(function* (
    input: TurnClassifyInput,
    timeoutMs: number = defaultTimeoutMs,
  ) {
    const startedMs = yield* Clock.currentTimeMillis;
    const apiKey = yield* resolveKey;
    if (apiKey === null) return skipped("key-missing");
    if ((yield* Ref.get(invalidKey)) === apiKey) return skipped("key-invalid");
    const instance = yield* loadBackend(apiKey);
    if (instance === null) return skipped("inference-error");

    const state = buildClassifyState(input);
    const key = cacheKeyFor(state);
    const cached = resultCache.get(key);
    if (cached !== undefined) {
      resultCache.delete(key);
      resultCache.set(key, cached);
      const hitMs = yield* Clock.currentTimeMillis;
      return {
        _tag: "Classified",
        ...cached,
        inputTokens: 0,
        latencyMs: hitMs - startedMs,
      } as ClassifyOutcome;
    }

    const questions = buildRouteQuestions();
    const requested = {
      handling_route: choice(
        questions.handling_route.instructions,
        questions.handling_route.criteria as Record<string, string>,
      ),
      complexity: score(questions.complexity.instructions, questions.complexity.criteria),
      is_self_contained: noul(questions.is_self_contained.instructions),
      is_sensitive_or_risky: noul(questions.is_sensitive_or_risky.instructions),
    };
    const response = yield* Effect.tryPromise(() =>
      Promise.resolve(instance.systemOne({ state, model: JEV_MODEL_ID, questions: requested })),
    ).pipe(
      Effect.timeoutOption(timeoutMs),
      Effect.catch((error) =>
        Effect.gen(function* () {
          const auth = isAuthFailure(error);
          yield* Ref.set(invalidKey, auth ? apiKey : null);
          return skipped(auth ? "key-invalid" : "inference-error");
        }),
      ),
    );
    if (response._tag === "None") {
      return skipped("inference-timeout");
    }
    if (response._tag === "Skipped") return response;
    const parsed = yield* Effect.try(() => toClassified(response.value)).pipe(Effect.option);
    if (Option.isNone(parsed)) return skipped("inference-error");
    const answers = parsed.value;
    const finishedMs = yield* Clock.currentTimeMillis;
    resultCache.set(key, answers);
    while (resultCache.size > RESULT_CACHE_MAX_ENTRIES) {
      const oldest = resultCache.keys().next();
      if (oldest.done) break;
      resultCache.delete(oldest.value);
    }
    yield* Ref.set(invalidKey, null);
    yield* Effect.logInfo("Jev classified turn", { route: answers.route, model: answers.model });
    return { _tag: "Classified", ...answers, latencyMs: finishedMs - startedMs } as ClassifyOutcome;
  });

  return JevEngine.of({
    status,
    classifyTurn: (input, timeoutMs) => classifyTurn(input, timeoutMs),
    close: Effect.void,
  });
});

export const layer = (options: JevEngineOptions): Layer.Layer<JevEngine> =>
  Layer.effect(JevEngine, make(options));

/** Test layer: engine disabled, every turn skips without touching the network. */
export const layerTest: Layer.Layer<JevEngine> = Layer.succeed(
  JevEngine,
  JevEngine.of({
    status: Effect.succeed({ _tag: "Disabled" } as EngineStatus),
    classifyTurn: () => Effect.succeed({ _tag: "Skipped", reason: "disabled" } as ClassifyOutcome),
    close: Effect.void,
  }),
);
