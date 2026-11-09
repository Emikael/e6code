import { describe, expect, it } from "vite-plus/test";

import { taskListLabel, taskListStepsFromPayload, taskListText } from "./taskList.js";

describe("taskListStepsFromPayload", () => {
  it("keeps valid steps, skips malformed ones, and reads unknown statuses as pending", () => {
    expect(
      taskListStepsFromPayload({
        plan: [
          { step: "Read code", status: "completed" },
          { step: "Write fix", status: "inProgress" },
          { step: "Test", status: "blocked" },
          { status: "completed" },
          null,
          "nope",
        ],
      }),
    ).toEqual([
      { step: "Read code", status: "completed" },
      { step: "Write fix", status: "inProgress" },
      { step: "Test", status: "pending" },
    ]);
  });

  it("returns null without a plan array", () => {
    expect(taskListStepsFromPayload({})).toBeNull();
    expect(taskListStepsFromPayload(null)).toBeNull();
    expect(taskListStepsFromPayload({ plan: "x" })).toBeNull();
  });
});

describe("taskListLabel", () => {
  it("counts done steps and names the step in progress", () => {
    expect(
      taskListLabel([
        { step: "A", status: "completed" },
        { step: "B", status: "completed" },
        { step: "C", status: "pending" },
        { step: "D", status: "inProgress" },
        { step: "E", status: "pending" },
      ]),
    ).toBe("Tasks 2/5 · D");
  });

  it("falls back to the first pending step, then to the bare count", () => {
    expect(
      taskListLabel([
        { step: "A", status: "completed" },
        { step: "B", status: "pending" },
      ]),
    ).toBe("Tasks 1/2 · B");
    expect(taskListLabel([{ step: "A", status: "completed" }])).toBe("Tasks 1/1");
  });
});

describe("taskListText", () => {
  it("marks each step with its status", () => {
    expect(
      taskListText([
        { step: "A", status: "completed" },
        { step: "B", status: "inProgress" },
        { step: "C", status: "pending" },
      ]),
    ).toBe("✓ A\n→ B\n○ C");
  });
});
