import { describe, expect, it } from "vite-plus/test";

import {
  isRunDetailsSectionOpen,
  modelEffortLabel,
  planLimitReading,
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
  it("opens Plan and Changes and closes Usage and Subagents by default", () => {
    expect(isRunDetailsSectionOpen("plan", undefined)).toBe(true);
    expect(isRunDetailsSectionOpen("changes", undefined)).toBe(true);
    expect(isRunDetailsSectionOpen("usage", undefined)).toBe(false);
    expect(isRunDetailsSectionOpen("subagents", undefined)).toBe(false);
  });

  it("keeps the user's own choice", () => {
    expect(isRunDetailsSectionOpen("plan", false)).toBe(false);
    expect(isRunDetailsSectionOpen("usage", true)).toBe(true);
  });

  it("opens Subagents when one starts working, even after an earlier close", () => {
    const live = { liveTurnId: "turn-2", closedInTurnId: null };
    expect(isRunDetailsSectionOpen("subagents", false, live)).toBe(true);
  });

  it("keeps Subagents closed for the rest of the turn the user closed it in", () => {
    const live = { liveTurnId: "turn-2", closedInTurnId: "turn-2" };
    expect(isRunDetailsSectionOpen("subagents", false, live)).toBe(false);
  });

  it("opens Subagents again in the next turn that starts one", () => {
    const live = { liveTurnId: "turn-3", closedInTurnId: "turn-2" };
    expect(isRunDetailsSectionOpen("subagents", false, live)).toBe(true);
  });

  it("follows the stored choice once no subagent works", () => {
    const idle = { liveTurnId: null, closedInTurnId: "turn-2" };
    expect(isRunDetailsSectionOpen("subagents", true, idle)).toBe(true);
    expect(isRunDetailsSectionOpen("subagents", false, idle)).toBe(false);
  });
});

describe("planLimitReading", () => {
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  const format = { locale: "en-US", timeZone: "UTC" };

  it("names the day when the reset is a day or more away", () => {
    const monday = Date.parse("2026-09-07T09:00:00.000Z");
    expect(planLimitReading(38, monday, now, format)).toBe("38% used · resets Mon");
  });

  it("names the clock time when the reset is sooner", () => {
    const later = Date.parse("2026-09-03T16:30:00.000Z");
    expect(planLimitReading(38, later, now, format)).toBe("38% used · resets 4:30 PM");
  });

  it("says only the share used without a future reset", () => {
    expect(planLimitReading(38, null, now, format)).toBe("38% used");
    expect(planLimitReading(38, now - 1, now, format)).toBe("38% used");
  });
});

describe("modelEffortLabel", () => {
  const effort = (currentValue: string) => ({
    id: "reasoningEffort",
    label: "Reasoning",
    type: "select" as const,
    currentValue,
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
      { id: "max", label: "Max" },
    ],
  });

  it("names the quick step the level is on", () => {
    expect(modelEffortLabel(effort("medium"))).toBe("Balanced");
    expect(modelEffortLabel(effort("high"))).toBe("Deep");
  });

  it("names a level outside the quick steps by its own label", () => {
    expect(modelEffortLabel(effort("max"))).toBe("Max");
  });

  it("says nothing for a model without an effort setting", () => {
    expect(modelEffortLabel(undefined)).toBeNull();
    expect(
      modelEffortLabel({ ...effort("medium"), id: "contextWindow", label: "Context" }),
    ).toBeNull();
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
