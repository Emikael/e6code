import type { ProviderOptionDescriptor } from "@e6tools/contracts";
import {
  EFFORT_SEGMENT_LABELS,
  effortSegmentForValue,
  resolveEffortSegments,
} from "@e6tools/client-runtime/effort-segments";
import {
  getProviderOptionCurrentValue,
  REASONING_SELECT_DESCRIPTOR_IDS,
} from "@e6tools/shared/model";

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

/** Live subagent work, for the Subagents section's open state. */
export interface SubagentsLiveWork {
  /** The turn in which a subagent is working now; null when none is. */
  readonly liveTurnId: string | null;
  /** The turn in which the user closed Subagents, if they did. */
  readonly closedInTurnId: string | null;
}

export const NO_LIVE_SUBAGENT_WORK: SubagentsLiveWork = { liveTurnId: null, closedInTurnId: null };

/**
 * Whether a Run details section is open. Plan and Changes start open; Usage and Subagents start
 * closed; a choice the user made on this device wins. Subagents also opens when a subagent starts
 * working in a turn, unless the user closed it during that turn; the next turn that starts one
 * opens it again. Outside live work the stored choice applies.
 */
export function isRunDetailsSectionOpen(
  section: RunDetailsSectionId,
  stored: boolean | undefined,
  live: SubagentsLiveWork = NO_LIVE_SUBAGENT_WORK,
): boolean {
  if (section === "subagents" && live.liveTurnId !== null) {
    return live.closedInTurnId !== live.liveTurnId;
  }
  if (stored !== undefined) return stored;
  return section === "plan" || section === "changes";
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A plan limit's reading, written the way its bar points: "38% used · resets Mon" when the reset
 * is a day or more away, "38% used · resets 4:30 PM" when it is sooner, "38% used" without one.
 * A clock time or a day, never a countdown.
 */
export function planLimitReading(
  usedPercent: number,
  resetsAt: number | null,
  now: number,
  format: { readonly locale?: string; readonly timeZone?: string } = {},
): string {
  const used = `${usedPercent}% used`;
  if (resetsAt === null || resetsAt <= now) return used;
  const options: Intl.DateTimeFormatOptions =
    resetsAt - now >= DAY_MS ? { weekday: "short" } : { hour: "numeric", minute: "2-digit" };
  if (format.timeZone) options.timeZone = format.timeZone;
  return `${used} · resets ${new Intl.DateTimeFormat(format.locale, options).format(resetsAt)}`;
}

/**
 * The effort word shown after a model's name: "Fast", "Balanced" or "Deep" when the level is
 * one of the quick steps, else the level's own label ("Max"). Null when the model has no
 * reasoning effort setting.
 */
export function modelEffortLabel(descriptor: ProviderOptionDescriptor | undefined): string | null {
  if (
    !descriptor ||
    descriptor.type !== "select" ||
    !REASONING_SELECT_DESCRIPTOR_IDS.has(descriptor.id)
  ) {
    return null;
  }
  const value = getProviderOptionCurrentValue(descriptor);
  if (typeof value !== "string") return null;
  const segments = resolveEffortSegments(descriptor);
  const segment = segments ? effortSegmentForValue(segments, value) : null;
  if (segment) return EFFORT_SEGMENT_LABELS[segment];
  return descriptor.options.find((option) => option.id === value)?.label ?? null;
}
