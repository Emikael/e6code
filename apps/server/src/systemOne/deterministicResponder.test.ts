import { describe, expect, it } from "@effect/vitest";

import { answerDeterministic, answerLocalFact } from "./deterministicResponder.ts";

describe("answerDeterministic", () => {
  it("greets greetings", () => {
    expect(answerDeterministic({ text: "hello!" })).toContain("Hello!");
    expect(answerDeterministic({ text: "  thanks  " })).toContain("How can I help");
  });

  it("names the project and thread from context", () => {
    expect(answerDeterministic({ text: "what is the project called?", projectName: "shop" })).toBe(
      'This project is called "shop".',
    );
    expect(answerDeterministic({ text: "what is the thread title?", threadTitle: "T" })).toBe(
      'This thread is titled "T".',
    );
  });

  it("returns null without the data or outside the set", () => {
    expect(answerDeterministic({ text: "what is the project called?" })).toBeNull();
    expect(answerDeterministic({ text: "refactor the auth module" })).toBeNull();
    expect(answerDeterministic({ text: "hello, refactor the auth module" })).toBeNull();
  });

  it("answers a chosen local fact even when the message is a paraphrase", () => {
    expect(
      answerLocalFact("project_name", { text: "remind me of the codebase", projectName: "shop" }),
    ).toBe('This project is called "shop".');
    expect(answerLocalFact("none", { text: "hello", projectName: "shop" })).toBeNull();
    expect(answerLocalFact("project_name", { text: "name?" })).toBeNull();
  });
});
