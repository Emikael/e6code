import { describe, expect, it } from "@effect/vitest";

import {
  buildClassifyState,
  buildRouteQuestions,
  estimateTokens,
  MAX_CHOICE_OPTIONS,
  MAX_OPTION_TOKENS,
  MAX_STATE_TOKENS,
  questionsWithinBudget,
  ROUTE_QUESTION_IDS,
  truncateToTokenBudget,
} from "./stateBuilder.ts";

describe("estimateTokens", () => {
  it("scales with length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("truncateToTokenBudget", () => {
  it("keeps short text intact", () => {
    expect(truncateToTokenBudget("hello", 100)).toBe("hello");
  });

  it("cuts long text to budget", () => {
    const cut = truncateToTokenBudget("x".repeat(4000), 100);
    expect(estimateTokens(cut)).toBeLessThanOrEqual(100);
  });
});

describe("buildClassifyState", () => {
  it("carries message plus compact metadata", () => {
    const state = buildClassifyState({
      lastMessage: "how do I reset my password?",
      threadTitle: "support",
      projectName: "shop",
      turnIndex: 3,
    });
    expect(state.lastMessage).toBe("how do I reset my password?");
    expect(state.projectName).toBe("shop");
    expect(state.turnIndex).toBe(3);
  });

  it("stays within the state budget on huge input", () => {
    const state = buildClassifyState({
      lastMessage: "y".repeat(8000),
      threadTitle: "t".repeat(2000),
      projectName: "p".repeat(2000),
    });
    expect(estimateTokens(JSON.stringify(state))).toBeLessThanOrEqual(MAX_STATE_TOKENS);
  });
});

describe("buildRouteQuestions", () => {
  it("asks the four v1 questions within model budgets", () => {
    const questions = buildRouteQuestions();
    expect(Object.keys(questions).sort()).toEqual([...ROUTE_QUESTION_IDS].sort());
    expect(questions.handling_route.type).toBe("choice");
    expect(questions.complexity.type).toBe("score");
    expect(questions.is_self_contained.type).toBe("noul");
    expect(questions.is_sensitive_or_risky.type).toBe("noul");
    expect(questionsWithinBudget(questions)).toBe(true);
  });

  it("rejects oversized question sets", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_CHOICE_OPTIONS + 1 }, (_, index) => [`opt${index}`, null]),
    );
    expect(
      questionsWithinBudget({ q: { type: "choice", instructions: "pick", criteria: tooMany } }),
    ).toBe(false);
    expect(
      questionsWithinBudget({
        q: {
          type: "score",
          instructions: "rate",
          criteria: ["ok", "z".repeat(MAX_OPTION_TOKENS * 4 + 8)],
        },
      }),
    ).toBe(false);
  });
});
