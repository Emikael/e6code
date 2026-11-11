import type { RunDetailsSectionId } from "~/uiStateStore";

type PlanStepStatus = "pending" | "inProgress" | "completed";

/** The word beside each plan step: what is finished, what runs, what comes next. */
export type PlanStepWord = "done" | "in progress" | "next" | "to do";

/**
 * One word per step. The first pending step after the running one (or the first pending step
 * when none runs) is "next"; later pending steps are "to do".
 */
export function planStepWords(
  steps: ReadonlyArray<{ readonly status: PlanStepStatus }>,
): PlanStepWord[] {
  const running = steps.findIndex((step) => step.status === "inProgress");
  let nextAssigned = false;
  return steps.map((step, index) => {
    if (step.status === "completed") return "done";
    if (step.status === "inProgress") return "in progress";
    if (!nextAssigned && index > running) {
      nextAssigned = true;
      return "next";
    }
    return "to do";
  });
}

/**
 * "Step 3 of 5": the running step, else the first step not done, else the last step. Position is
 * always written this way; counts of finished things use "N of M done" wording elsewhere.
 */
export function planPositionLabel(
  steps: ReadonlyArray<{ readonly status: PlanStepStatus }>,
): string {
  const total = steps.length;
  const running = steps.findIndex((step) => step.status === "inProgress");
  const firstOpen = steps.findIndex((step) => step.status !== "completed");
  const index = running >= 0 ? running : firstOpen >= 0 ? firstOpen : total - 1;
  return `Step ${Math.max(0, index) + 1} of ${total}`;
}

/**
 * Whether a Run details section is open. A choice the user made on this device wins. Otherwise
 * Plan and Changes start open, Usage starts closed, and Subagents is open while one is working.
 */
export function isRunDetailsSectionOpen(
  section: RunDetailsSectionId,
  stored: boolean | undefined,
  context: { readonly subagentWorking: boolean },
): boolean {
  if (stored !== undefined) return stored;
  switch (section) {
    case "plan":
    case "changes":
      return true;
    case "subagents":
      return context.subagentWorking;
    case "usage":
      return false;
  }
}

/** File rows Changes lists before "Show all N". */
export const RUN_DETAILS_CHANGES_PREVIEW_LIMIT = 5;

/** "Push 1 commit", "Push 2 commits". */
export function pushCommitsLabel(count: number): string {
  return `Push ${count} ${count === 1 ? "commit" : "commits"}`;
}

/**
 * A plan limit written in the same direction as its bar: "38% used". Providers report what is
 * left, so the used share is its complement.
 */
export function planLimitUsedPercent(remainingPercent: number): number {
  return Math.max(0, Math.min(100, 100 - remainingPercent));
}
