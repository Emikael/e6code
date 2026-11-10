/**
 * An agent's task list (a `turn.plan.updated` activity) as web and mobile show
 * it: a `Tasks done/total · current step` row that opens to every step.
 */

export type TaskListStepStatus = "pending" | "inProgress" | "completed";

export interface TaskListStep {
  readonly step: string;
  readonly status: TaskListStepStatus;
}

/** Text marks for a step's status, used where a step list is plain text (copy, web detail). */
const TASK_LIST_STEP_MARKS = {
  completed: "✓",
  inProgress: "→",
  pending: "○",
} as const satisfies Record<TaskListStepStatus, string>;

/** Status words, so a step never shows its state by icon or color alone. */
export const TASK_LIST_STEP_STATUS_LABELS = {
  completed: "Done",
  inProgress: "In progress",
  pending: "Pending",
} as const satisfies Record<TaskListStepStatus, string>;

/** Todo tools whose successful calls are already shown by the turn's Tasks row. */
const TASK_LIST_TOOL_NAMES: ReadonlySet<string> = new Set([
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
]);

/**
 * A successful todo tool call in a turn whose plan update already shows it as
 * a Tasks row, so the work log hides the tool row. Claude's todo tools emit
 * both; `planUpdateTurnIds` holds the turns that have a `turn.plan.updated`.
 */
export function isTaskListToolActivity(
  activity: {
    readonly kind: string;
    readonly tone?: string | undefined;
    readonly turnId: string | null;
    readonly payload: unknown;
  },
  planUpdateTurnIds: ReadonlySet<string>,
): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") return false;
  if (activity.tone === "error" || !activity.turnId || !planUpdateTurnIds.has(activity.turnId)) {
    return false;
  }
  const payload = activity.payload;
  const data =
    payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined;
  const toolName =
    data && typeof data === "object" ? (data as { toolName?: unknown }).toolName : undefined;
  return typeof toolName === "string" && TASK_LIST_TOOL_NAMES.has(toolName);
}

/**
 * Reads the steps of a `turn.plan.updated` payload. Malformed steps are
 * skipped and unknown statuses read as pending. Returns null when the payload
 * carries no plan array.
 */
export function taskListStepsFromPayload(payload: unknown): TaskListStep[] | null {
  const rawPlan =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>).plan : undefined;
  if (!Array.isArray(rawPlan)) return null;
  const steps: TaskListStep[] = [];
  for (const entry of rawPlan) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.step !== "string") continue;
    const status =
      record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
    steps.push({ step: record.step, status });
  }
  return steps;
}

/** The step being worked on: the first in progress, else the first still pending. */
function currentTaskListStep(steps: ReadonlyArray<TaskListStep>): TaskListStep | undefined {
  return (
    steps.find((step) => step.status === "inProgress") ??
    steps.find((step) => step.status === "pending")
  );
}

/** `Tasks 2/5 · Current step`, or `Tasks 5/5` once nothing is left. */
export function taskListLabel(steps: ReadonlyArray<TaskListStep>): string {
  const done = steps.filter((step) => step.status === "completed").length;
  const current = currentTaskListStep(steps);
  return `Tasks ${done}/${steps.length}${current ? ` · ${current.step}` : ""}`;
}

/** One `mark step` line per step. */
export function taskListText(steps: ReadonlyArray<TaskListStep>): string {
  return steps.map((step) => `${TASK_LIST_STEP_MARKS[step.status]} ${step.step}`).join("\n");
}
