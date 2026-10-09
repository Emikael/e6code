import { describe, expect, it } from "@effect/vitest";

import {
  buildClassifyState,
  buildRouteQuestions,
  estimateTokens,
  formatRecentTurns,
  MAX_CHOICE_OPTIONS,
  MAX_OPTION_TOKENS,
  MAX_STATE_TOKENS,
  questionsWithinBudget,
  RECENT_TURNS_TOKEN_BUDGET,
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
      recentTurns: "user: rename the login form\nassistant: Done.",
    });
    expect(state.lastMessage).toBe("how do I reset my password?");
    expect(state.projectName).toBe("shop");
    expect(state.turnIndex).toBe(3);
    expect(state.recentTurns).toBe("user: rename the login form\nassistant: Done.");
  });

  it("stays within the state budget on huge input", () => {
    const state = buildClassifyState({
      lastMessage: "y".repeat(MAX_STATE_TOKENS * 8),
      threadTitle: "t".repeat(2000),
      projectName: "p".repeat(2000),
      recentTurns: "user: " + "q".repeat(RECENT_TURNS_TOKEN_BUDGET * 8),
    });
    expect(estimateTokens(JSON.stringify(state))).toBeLessThanOrEqual(MAX_STATE_TOKENS);
    expect(state.lastMessage).not.toBe("y".repeat(MAX_STATE_TOKENS * 8));
  });
});

describe("formatRecentTurns", () => {
  it("keeps the previous user and assistant texts and drops the live message", () => {
    expect(
      formatRecentTurns(
        [
          { id: "u1", role: "user", text: "rename the button" },
          { id: "a1", role: "assistant", text: "Renamed it." },
          { id: "u2", role: "user", text: "do that again" },
          { id: "r1", role: "reasoning", text: "scratch" },
        ],
        "u2",
      ),
    ).toBe("user: rename the button\nassistant: Renamed it.");
  });
});

describe("buildRouteQuestions", () => {
  it("asks the handler questions within model budgets", () => {
    const questions = buildRouteQuestions();
    expect(Object.keys(questions).sort()).toEqual([...ROUTE_QUESTION_IDS].sort());
    expect(questions.handling_route.type).toBe("choice");
    expect(questions.handling_route.instructions).toContain("`lastMessage`");
    expect(questions.local_fact.type).toBe("choice");
    expect(questions.depends_on_earlier_turns.type).toBe("noul");
    expect(questions.depends_on_earlier_turns.instructions).toContain("`recentTurns`");
    expect(questions.depends_on_earlier_turns.criteria?.true).toBeTruthy();
    expect(questions.is_sensitive_or_risky.type).toBe("noul");
    expect(questions.is_sensitive_or_risky.criteria?.false).toBeTruthy();
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
          criteria: ["ok", "z".repeat(MAX_OPTION_TOKENS * 4 + 8)] as [string, string],
        },
      }),
    ).toBe(false);
  });
});
