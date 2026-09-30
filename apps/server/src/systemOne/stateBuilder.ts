/**
 * stateBuilder - packs a turn into Laya's budgets before any inference runs.
 *
 * Laya truncates hard: 512 tokens of state (`max_len`), 192 tokens per
 * question option (`head_max_len`), and under ~20 options per Choice is the
 * model's own recommendation. Everything here is pure so the budgets are
 * unit-testable without loading the ~1.7GB weights.
 *
 * Token counts are a chars/4 heuristic. The engine enforces the exact limits
 * with the real tokenizer and fails open to the LLM on overflow, so an
 * underestimate here only costs a skipped Laya call, never a wrong answer.
 *
 * @module stateBuilder
 */
import type { ChoiceQuestion, NoulQuestion, Question, ScoreQuestion } from "./judgmentTypes.ts";

/** State is truncated past this many estimated tokens (English checkpoint). */
export const MAX_STATE_TOKENS = 512;
/** Each Choice option / Score level stays under this many estimated tokens. */
export const MAX_OPTION_TOKENS = 192;
/** Model recommendation: keep Choice option counts below this. */
export const MAX_CHOICE_OPTIONS = 20;

/** Rough token estimate; exact counting happens inside the engine. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const truncateToTokenBudget = (text: string, budgetTokens: number): string => {
  if (estimateTokens(text) <= budgetTokens) return text;
  return text.slice(0, budgetTokens * 4);
};

export interface TurnClassifyInput {
  readonly lastMessage: string;
  readonly threadTitle?: string;
  readonly projectName?: string;
  readonly turnIndex?: number;
}

/**
 * Compact JSON state for one turn. Carries the latest message plus just
 * enough metadata to disambiguate, never secrets, keys, or full history.
 */
export const buildClassifyState = (input: TurnClassifyInput): Record<string, unknown> => {
  const state: Record<string, unknown> = {
    lastMessage: truncateToTokenBudget(input.lastMessage, MAX_STATE_TOKENS - 32),
  };
  if (input.threadTitle !== undefined) {
    state.threadTitle = truncateToTokenBudget(input.threadTitle, 24);
  }
  if (input.projectName !== undefined) {
    state.projectName = truncateToTokenBudget(input.projectName, 16);
  }
  if (input.turnIndex !== undefined) state.turnIndex = input.turnIndex;
  const serialized = JSON.stringify(state);
  if (estimateTokens(serialized) <= MAX_STATE_TOKENS) return state;
  return { lastMessage: truncateToTokenBudget(input.lastMessage, MAX_STATE_TOKENS - 8) };
};

export const ROUTE_QUESTION_IDS = [
  "handling_route",
  "complexity",
  "is_self_contained",
  "is_sensitive_or_risky",
] as const;

/** Precise v1 question map, so `systemOne` answers come back typed per id. */
export type RouteQuestions = {
  handling_route: ChoiceQuestion;
  complexity: ScoreQuestion;
  is_self_contained: NoulQuestion;
  is_sensitive_or_risky: NoulQuestion;
};

/**
 * The v1 question set. Q1 routes, Q2 grades complexity, Q3/Q4 gate the
 * skip-LLM paths. All four run in one forward pass over the same state.
 */
export const buildRouteQuestions = (): RouteQuestions => ({
  handling_route: {
    type: "choice",
    instructions: "How should this turn be handled?",
    criteria: {
      answer_deterministic: "Answerable from app state without any LLM call",
      fast_llm_trimmed: "Simple question for a small model with short context",
      full_llm: "Needs the full provider model and context",
      needs_tools: "Needs repo reads, file edits, or tool calls",
      out_of_scope: "Not a task for this coding assistant",
    },
  },
  complexity: {
    type: "score",
    instructions: "How complex is this request to resolve?",
    criteria: [
      "Simple lookup or standard procedure",
      "Requires some judgment or multi-step process",
      "Unusual situation, edge case, or escalation needed",
    ],
  },
  is_self_contained: {
    type: "noul",
    instructions: "Is the latest message answerable without tools or repo reads?",
  },
  is_sensitive_or_risky: {
    type: "noul",
    instructions: "Does this involve secrets, credentials, or destructive operations?",
  },
});

/** Fails a question set that would overflow the model's option budget. */
export const questionsWithinBudget = (questions: Readonly<Record<string, Question>>): boolean =>
  Object.values(questions).every((question) => {
    if (question.type === "choice") {
      const options = Object.entries(question.criteria);
      if (options.length > MAX_CHOICE_OPTIONS) return false;
      return options.every(([, description]) =>
        description === null ? true : estimateTokens(description) <= MAX_OPTION_TOKENS,
      );
    }
    if (question.type === "score") {
      return (
        question.criteria.length >= 2 &&
        question.criteria.every((level) => estimateTokens(level) <= MAX_OPTION_TOKENS)
      );
    }
    return true;
  });
