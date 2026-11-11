import { describe, expect, it } from "vite-plus/test";

import {
  isRunDetailsSectionOpen,
  planLimitUsedPercent,
  planPositionLabel,
  planStepWords,
  pushCommitsLabel,
} from "./runDetails.logic";

const steps = (...statuses: Array<"pending" | "inProgress" | "completed">) =>
  statuses.map((status) => ({ status }));

describe("planStepWords", () => {
  it("names done, the running step, the next one and the rest", () => {
    expect(
      planStepWords(steps("completed", "completed", "inProgress", "pending", "pending")),
    ).toEqual(["done", "done", "in progress", "next", "to do"]);
  });

  it("calls the first open step next when nothing runs", () => {
    expect(planStepWords(steps("completed", "pending", "pending"))).toEqual([
      "done",
      "next",
      "to do",
    ]);
  });

  it("does not call a step before the running one next", () => {
    expect(planStepWords(steps("pending", "inProgress", "pending"))).toEqual([
      "to do",
      "in progress",
      "next",
    ]);
  });
});

describe("planPositionLabel", () => {
  it("points at the running step", () => {
    expect(
      planPositionLabel(steps("completed", "completed", "inProgress", "pending", "pending")),
    ).toBe("Step 3 of 5");
  });

  it("points at the first open step when nothing runs", () => {
    expect(planPositionLabel(steps("completed", "pending"))).toBe("Step 2 of 2");
  });

  it("stays on the last step once everything is done", () => {
    expect(planPositionLabel(steps("completed", "completed"))).toBe("Step 2 of 2");
  });
});

describe("isRunDetailsSectionOpen", () => {
  it("opens Plan and Changes and closes Usage by default", () => {
    const context = { subagentWorking: false };
    expect(isRunDetailsSectionOpen("plan", undefined, context)).toBe(true);
    expect(isRunDetailsSectionOpen("changes", undefined, context)).toBe(true);
    expect(isRunDetailsSectionOpen("usage", undefined, context)).toBe(false);
  });

  it("opens Subagents only while one is working", () => {
    expect(isRunDetailsSectionOpen("subagents", undefined, { subagentWorking: true })).toBe(true);
    expect(isRunDetailsSectionOpen("subagents", undefined, { subagentWorking: false })).toBe(false);
  });

  it("keeps the user's own choice", () => {
    expect(isRunDetailsSectionOpen("plan", false, { subagentWorking: false })).toBe(false);
    expect(isRunDetailsSectionOpen("subagents", false, { subagentWorking: true })).toBe(false);
    expect(isRunDetailsSectionOpen("usage", true, { subagentWorking: false })).toBe(true);
  });
});

describe("labels", () => {
  it("counts commits to push", () => {
    expect(pushCommitsLabel(1)).toBe("Push 1 commit");
    expect(pushCommitsLabel(2)).toBe("Push 2 commits");
  });

  it("writes a limit as the share used", () => {
    expect(planLimitUsedPercent(62)).toBe(38);
    expect(planLimitUsedPercent(120)).toBe(0);
  });
});
