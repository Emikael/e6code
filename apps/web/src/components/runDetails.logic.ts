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
import { foldGeneratedFiles } from "./diffs/diffFileRail.logic";

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

const NO_LIVE_SUBAGENT_WORK: SubagentsLiveWork = { liveTurnId: null, closedInTurnId: null };

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
 * A plan limit's reading, written the way its bar points. The reset is a clock time when it falls
 * today ("38% used · resets 4:30 PM"), the day and time when it falls on another day within 24
 * hours ("resets Tue 1:00 AM"), the day alone within six days ("resets Mon"), and a date beyond
 * that ("resets Nov 24"). "38% used" without one. Never a countdown.
 */
export function planLimitReading(
  usedPercent: number,
  resetsAt: number | null,
  now: number,
  format: { readonly locale?: string; readonly timeZone?: string } = {},
): string {
  const used = `${usedPercent}% used`;
  if (resetsAt === null || resetsAt <= now) return used;
  const zone: Intl.DateTimeFormatOptions = format.timeZone ? { timeZone: format.timeZone } : {};
  const write = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(format.locale, { ...options, ...zone }).format(resetsAt);
  const calendarDay = (at: number) =>
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...zone,
    }).format(at);
  const away = resetsAt - now;
  let reset: string;
  if (away > 6 * DAY_MS) {
    reset = write({ month: "short", day: "numeric" });
  } else if (away >= DAY_MS) {
    reset = write({ weekday: "short" });
  } else if (calendarDay(resetsAt) === calendarDay(now)) {
    reset = write({ hour: "numeric", minute: "2-digit" });
  } else {
    reset = write({ weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  return `${used} · resets ${reset}`;
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

/**
 * Changes lists the working tree as the Diff does: generated files folded until shown, and the
 * line counts taken from the files listed, so "1 of 2 reviewed" here matches "Diff · 2 files".
 */
export function runDetailsChangedFiles<
  T extends { readonly path: string; readonly insertions: number; readonly deletions: number },
>(files: readonly T[], showGenerated: boolean) {
  const { items, generatedCount } = foldGeneratedFiles(files, (file) => file.path, showGenerated);
  return {
    files: items,
    generatedCount,
    insertions: items.reduce((total, file) => total + file.insertions, 0),
    deletions: items.reduce((total, file) => total + file.deletions, 0),
  };
}

/**
 * An activity line split at its backtick spans, so a command reads as code: "Running `vp test`"
 * gives "Running " then the code "vp test". An unclosed backtick stays text.
 */
export function inlineCodeSegments(text: string): Array<{ text: string; code: boolean }> {
  const segments: Array<{ text: string; code: boolean }> = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf("`");
    const close = open === -1 ? -1 : rest.indexOf("`", open + 1);
    if (close === -1) break;
    if (open > 0) segments.push({ text: rest.slice(0, open), code: false });
    if (close > open + 1) segments.push({ text: rest.slice(open + 1, close), code: true });
    rest = rest.slice(close + 1);
  }
  if (rest.length > 0) segments.push({ text: rest, code: false });
  return segments;
}

const REMEMBERED_TURN_DURATIONS_LIMIT = 64;

/**
 * The latest finished turn's duration for a thread. The read model times only the latest turn,
 * which has no duration while it runs, so the last finished one is remembered per thread and
 * shown until the running turn finishes.
 */
export function rememberedTurnDuration(
  memory: Map<string, number>,
  threadKey: string,
  durationMs: number | null,
): number | null {
  if (durationMs === null) return memory.get(threadKey) ?? null;
  memory.delete(threadKey);
  memory.set(threadKey, durationMs);
  if (memory.size > REMEMBERED_TURN_DURATIONS_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  return durationMs;
}
