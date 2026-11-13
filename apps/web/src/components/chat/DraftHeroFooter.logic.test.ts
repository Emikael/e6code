import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import {
  asSentence,
  formatAttentionCue,
  needsYouHeading,
  planSegments,
  reviewCaption,
  selectStartScreenBlocked,
  selectWorkingThreads,
  workingCaption,
} from "./DraftHeroFooter.logic";

const thread = (id: string, overrides: Partial<EnvironmentThreadShell> = {}) =>
  ({
    id,
    environmentId: "local",
    archivedAt: null,
    session: null,
    ...overrides,
  }) as unknown as EnvironmentThreadShell;
const running = (status: "running" | "starting" | "ready") =>
  ({ status }) as EnvironmentThreadShell["session"];

describe("needsYouHeading", () => {
  it("counts blocked agents", () => {
    expect(needsYouHeading(1)).toBe("Needs you · 1 agent is blocked");
    expect(needsYouHeading(2)).toBe("Needs you · 2 agents are blocked");
  });
});

describe("formatAttentionCue", () => {
  it.each([
    ["asked", "4m", "asked 4m ago"],
    ["finished", "now", "finished just now"],
    ["ready", "since Tue", "ready Tue"],
    ["asked", "", ""],
  ])("%s with %s reads %s", (verb, age, cue) => {
    expect(formatAttentionCue(verb, age)).toBe(cue);
  });
});

describe("reviewCaption", () => {
  it("names plans and done turns, with line totals when there are any", () => {
    expect(reviewCaption("plan", { insertions: 3, deletions: 1 })).toBe("Plan ready");
    expect(reviewCaption("done", { insertions: 4, deletions: 4 })).toBe("Done · +4 −4");
    expect(reviewCaption("done", { insertions: 0, deletions: 0 })).toBe("Done");
    expect(reviewCaption("done", undefined)).toBe("Done");
  });
});

describe("planSegments", () => {
  it("marks finished steps, the live one, then the rest", () => {
    expect(planSegments({ completedSteps: 2, totalSteps: 5 })).toEqual([
      "done",
      "done",
      "live",
      "todo",
      "todo",
    ]);
    expect(planSegments({ completedSteps: 3, totalSteps: 3 })).toEqual(["done", "done", "done"]);
    expect(planSegments({ completedSteps: 0, totalSteps: 0 })).toEqual([]);
  });
});

describe("selectWorkingThreads", () => {
  const startedAt = (value: EnvironmentThreadShell) =>
    ({ late: "2026-11-01T10:05:00.000Z", early: "2026-11-01T10:00:00.000Z" })[String(value.id)] ??
    null;

  it("lists running threads oldest start first, leaving out blocked, idle and archived", () => {
    const rows = selectWorkingThreads(
      [
        thread("late", { session: running("running") }),
        thread("unknown", { session: running("starting") }),
        thread("early", { session: running("running") }),
        thread("idle", { session: running("ready") }),
        thread("gone", { session: running("running"), archivedAt: "2026-11-01T09:00:00.000Z" }),
        thread("waiting", { session: running("running") }),
      ],
      { blocked: [{ key: "local:waiting" } as never], earlier: [] },
      startedAt,
    );
    expect(rows.map((row) => String(row.thread.id))).toEqual(["early", "late", "unknown"]);
  });
});

describe("selectStartScreenBlocked", () => {
  it("keeps approvals and questions and leaves failures to the sidebar", () => {
    const items = [
      { key: "a", kind: "approval" as const },
      { key: "f", kind: "failed" as const },
      { key: "q", kind: "input" as const },
    ];
    expect(selectStartScreenBlocked(items).map((item) => item.key)).toEqual(["a", "q"]);
  });
});

describe("workingCaption", () => {
  const resetAt = () => "14:20";
  it("names the step when a plan is reported", () => {
    expect(
      workingCaption(
        {
          agentState: undefined,
          planProgress: { step: "Updating the token map", completedSteps: 2, totalSteps: 5 },
        },
        resetAt,
      ),
    ).toBe("Step 3 of 5 · Updating the token map");
  });

  it("falls back to the agent state, then to Working", () => {
    expect(workingCaption({ agentState: undefined, planProgress: null }, resetAt)).toBe("Working");
    expect(
      workingCaption(
        {
          agentState: { kind: "retrying", attempt: 2, maxAttempts: 10 },
          planProgress: { step: "Ignored", completedSteps: 0, totalSteps: 2 },
        } as never,
        resetAt,
      ),
    ).toBe("Retrying · attempt 2 of 10");
  });
});

describe("asSentence", () => {
  it("adds a period unless the fact already ends a sentence", () => {
    expect(asSentence("Codex wants to run 1 command")).toBe("Codex wants to run 1 command.");
    expect(asSentence("Claude asks 1 question: spring, or a fade?")).toBe(
      "Claude asks 1 question: spring, or a fade?",
    );
    expect(asSentence("Claude asks 1 question: keep it…")).toBe("Claude asks 1 question: keep it…");
  });
});
