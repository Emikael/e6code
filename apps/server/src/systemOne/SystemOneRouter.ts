/**
 * SystemOneRouter - one turn in, one routing outcome out.
 *
 * Owns the whole pre-LLM funnel: cheap pre-checks that skip the Jev call,
 * the engine classification, the confidence policy, and the v0
 * deterministic templates. Never fails and never throws: every failure mode
 * becomes a FullLlm outcome so the turn always reaches the provider.
 *
 * @module SystemOneRouter
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { decideRoute, type PolicyThresholds } from "./confidencePolicy.ts";
import { answerDeterministic, answerLocalFact } from "./deterministicResponder.ts";
import { JevEngine } from "./JevEngine.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { type SystemOneRecordOutcome, SystemOneUsageTracker } from "./systemOneUsageTracker.ts";
import { buildClassifyState } from "./stateBuilder.ts";

/**
 * Best-effort tripwire for bearer material. Sensitivity is judged by the
 * model only after upload, so turns whose message or recent-turn excerpt
 * already looks like keys route straight to the full LLM without ever
 * leaving the machine. The sensitivity noul still judges everything else.
 */
const KEY_LIKE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bsk[_-](live|test)[_-][A-Za-z0-9]{8,}/,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bsk-proj-[A-Za-z0-9_-]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[bpas]-[A-Za-z0-9-]{8,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bxai-[A-Za-z0-9]{8,}/,
  /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/,
];

const looksLikeKeyMaterial = (text: string): boolean =>
  KEY_LIKE_PATTERNS.some((pattern) => pattern.test(text));

export interface RouteTurnInput {
  readonly text: string;
  readonly hasAttachments: boolean;
  readonly threadTitle?: string;
  readonly projectName?: string;
  /**
   * Prior user and assistant text, excluding this turn's message. Run only
   * when the turn is about to be classified, so rejected turns never load it.
   */
  readonly loadRecentTurns?: Effect.Effect<string | undefined>;
}

export type RouteOutcome =
  | {
      readonly _tag: "Deterministic";
      readonly text: string;
      readonly route: string;
      readonly confidence: number;
      readonly latencyMs: number;
      readonly inputTokens: number;
      readonly model?: string;
    }
  | {
      readonly _tag: "FastPath";
      readonly route: string;
      readonly confidence: number;
      readonly latencyMs: number;
      readonly inputTokens: number;
      readonly model?: string;
    }
  | {
      readonly _tag: "FullLlm";
      readonly reason: string;
      readonly policyRoute?: string;
      readonly confidence?: number;
      readonly latencyMs?: number;
      readonly inputTokens?: number;
      readonly model?: string;
    };

export interface SystemOneRouterOptions {
  readonly thresholds?: PolicyThresholds;
}

export class SystemOneRouter extends Context.Service<
  SystemOneRouter,
  {
    /** Never fails: every failure mode becomes a FullLlm outcome. */
    readonly routeTurn: (input: RouteTurnInput) => Effect.Effect<RouteOutcome>;
  }
>()("e6/systemOne/SystemOneRouter") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("SystemOneRouter.make")(function* (
  options: SystemOneRouterOptions = {},
) {
  const engine = yield* JevEngine;
  const serverSettings = yield* ServerSettingsService;
  // serviceOption's declared channels default to unknown; the call never
  // fails and needs nothing, so pin them instead of polluting every layer.
  const usageTracker = yield* Effect.serviceOption(SystemOneUsageTracker) as Effect.Effect<
    Option.Option<SystemOneUsageTracker["Service"]>,
    never,
    never
  >;

  const note = (
    outcome: SystemOneRecordOutcome,
    latencyMs?: number,
    jevInputTokens?: number,
  ): Effect.Effect<void> => {
    if (Option.isNone(usageTracker)) return Effect.void;
    return usageTracker.value.record({
      outcome,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(jevInputTokens !== undefined ? { jevInputTokens } : {}),
    });
  };

  const routeTurn = Effect.fn("SystemOneRouter.routeTurn")(function* (input: RouteTurnInput) {
    const settings = yield* serverSettings.getPersistedSettings.pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (settings === null || !settings.systemOne.enabled) {
      return { _tag: "FullLlm", reason: "router-disabled" } as RouteOutcome;
    }
    const thresholds = options.thresholds ?? settings.systemOne;
    if (input.text.trim().length === 0)
      return { _tag: "FullLlm", reason: "empty-text" } as RouteOutcome;
    if (input.hasAttachments) return { _tag: "FullLlm", reason: "has-attachments" } as RouteOutcome;
    if (looksLikeKeyMaterial(input.text)) {
      return { _tag: "FullLlm", reason: "key-like-material" } as RouteOutcome;
    }

    const context = {
      text: input.text,
      ...(input.threadTitle !== undefined ? { threadTitle: input.threadTitle } : {}),
      ...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
    };
    // Exact templates are known rules. Answer them here so "hi" never waits
    // on Jev; they count as avoided provider calls, not Jev calls.
    const exact = answerDeterministic(context);
    if (exact !== null) {
      yield* note("local");
      return {
        _tag: "Deterministic",
        text: exact,
        route: "local_lookup",
        confidence: 1,
        latencyMs: 0,
        inputTokens: 0,
      } as RouteOutcome;
    }

    const messageInput = {
      lastMessage: input.text,
      ...(input.threadTitle !== undefined ? { threadTitle: input.threadTitle } : {}),
      ...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
    };
    if (buildClassifyState(messageInput).lastMessage !== input.text) {
      return { _tag: "FullLlm", reason: "text-too-long" } as RouteOutcome;
    }
    const recentTurns =
      input.loadRecentTurns === undefined ? undefined : yield* input.loadRecentTurns;
    if (recentTurns !== undefined && looksLikeKeyMaterial(recentTurns)) {
      return { _tag: "FullLlm", reason: "key-like-material" } as RouteOutcome;
    }
    const classifyInput = {
      ...messageInput,
      ...(recentTurns !== undefined ? { recentTurns } : {}),
    };
    const outcome = yield* engine.classifyTurn(classifyInput, settings.systemOne.timeoutMs);
    if (outcome._tag === "Skipped") {
      return { _tag: "FullLlm", reason: `jev-skipped:${outcome.reason}` } as RouteOutcome;
    }
    const decision = decideRoute(outcome, thresholds);
    const classified = {
      confidence: outcome.routeConfidence,
      latencyMs: outcome.latencyMs,
      inputTokens: outcome.inputTokens,
      model: outcome.model,
    };
    if (decision._tag === "FullLlm") {
      yield* note("full-llm", outcome.latencyMs, outcome.inputTokens);
      return {
        _tag: "FullLlm",
        reason: decision.reason,
        policyRoute: outcome.route,
        ...classified,
      } as RouteOutcome;
    }
    if (decision._tag === "FastPath") {
      yield* note("fast-path", outcome.latencyMs, outcome.inputTokens);
      return {
        _tag: "FastPath",
        route: outcome.route,
        ...classified,
      } as RouteOutcome;
    }
    const text = answerLocalFact(outcome.localFact, context);
    if (text === null) {
      yield* note("full-llm", outcome.latencyMs, outcome.inputTokens);
      return { _tag: "FullLlm", reason: "no-deterministic-template" } as RouteOutcome;
    }
    yield* note("deterministic", outcome.latencyMs, outcome.inputTokens);
    return {
      _tag: "Deterministic",
      text,
      route: outcome.route,
      ...classified,
    } as RouteOutcome;
  });

  return SystemOneRouter.of({ routeTurn: (input) => routeTurn(input) });
});

export const layer = (
  options: SystemOneRouterOptions = {},
): Layer.Layer<SystemOneRouter, never, JevEngine | ServerSettingsService> =>
  Layer.effect(SystemOneRouter, make(options));

/** Test layer: routing disabled, every turn goes to the full LLM. */
export const layerTest: Layer.Layer<SystemOneRouter> = Layer.succeed(
  SystemOneRouter,
  SystemOneRouter.of({
    routeTurn: () =>
      Effect.succeed({ _tag: "FullLlm", reason: "router-disabled-in-test" } as RouteOutcome),
  }),
);
