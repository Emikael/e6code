import { formatRunningThreadStatus } from "@e6tools/client-runtime/state/agent-state";
import { approvalPhrase, approvalWordingKind } from "@e6tools/client-runtime/pending-requests";
import { toolGroupAction } from "@e6tools/client-runtime/work-log/presentation";
import type {
  OrchestrationCheckpointSummary,
  ProviderRequestKind,
  ThreadAgentState,
  TurnId,
} from "@e6tools/contracts";

import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import type { WorkLogEntry } from "../../session-logic";
import { formatWorkedDuration } from "../../threadNotificationPolicy";
import { liveWorkEntryLabel } from "./MessagesTimeline.logic";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * What the now bar under the thread header says (board 2, F5). One state at a
 * time: a request blocked on you wins over work in progress, which wins over
 * the last turn's outcome. `hidden` before the first turn, after a stop, and
 * when nothing is known.
 */
export type NowBarState =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "working";
      /** "Working", or the agent state that explains a stall ("Retrying", "Compacting"). */
      readonly status: string;
      /**
       * The status mark: a live agent gets the halo; the waits it cannot act on
       * are neutral, a hollow ring while retrying and a pause for a usage limit.
       */
      readonly mark: "live" | "retrying" | "usage-limit";
      /** The plan step meter, only while the agent reports a plan. */
      readonly progress: { readonly completedSteps: number; readonly totalSteps: number } | null;
      /** "Step 3 of 5 · Updating the token map", the current action, or the stall detail. */
      readonly text: string | null;
      readonly startedAt: string | null;
    }
  | {
      readonly kind: "blocked";
      readonly request: "approval" | "input";
      /** "Codex wants to run 1 command". */
      readonly text: string;
      readonly since: string;
    }
  | { readonly kind: "failed"; readonly text: string }
  | {
      readonly kind: "done";
      /** "Worked 3m 40s · finished 14:06" is built from these. */
      readonly workedFor: string | null;
      readonly finishedAt: string;
      readonly hasChanges: boolean;
    };

export interface NowBarInput {
  readonly isWorking: boolean;
  readonly workStartedAt: string | null;
  readonly planProgress:
    | { readonly step: string; readonly completedSteps: number; readonly totalSteps: number }
    | null
    | undefined;
  readonly agentState: ThreadAgentState | null | undefined;
  /** The running turn's latest tool action, from {@link selectCurrentAction}. */
  readonly currentAction: string | null;
  readonly pendingApprovals: ReadonlyArray<{
    readonly requestKind: ProviderRequestKind;
    readonly unnamedKind?: true;
    readonly createdAt: string;
  }>;
  readonly pendingUserInputs: ReadonlyArray<{
    readonly createdAt: string;
    readonly questions: ReadonlyArray<{ readonly question: string }>;
  }>;
  /** "Codex", or "The agent" when the provider is unknown. */
  readonly provider: string;
  /** The failure sentence ("Codex stopped: …") when the thread failed, else null. */
  readonly failure: string | null;
  /** "14:20" for "resets 14:20"; without it a usage-limit wait names no time. */
  readonly formatResetTime?: (resetsAt: string) => string;
  readonly latestTurn: {
    readonly state: "running" | "interrupted" | "completed" | "error";
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly diffStat?: { readonly insertions: number; readonly deletions: number } | undefined;
  } | null;
}

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

function earliest(times: ReadonlyArray<string>): string {
  return times.reduce((first, time) => (Date.parse(time) < Date.parse(first) ? time : first));
}

/** "Codex wants to run 1 command", "Claude wants to change files". */
function approvalAskText(provider: string, approvals: NowBarInput["pendingApprovals"]): string {
  const [first] = approvals;
  if (!first) return `${provider} is waiting for your approval`;
  const kind = approvalWordingKind(first);
  if (kind === "command") {
    const commands = approvals.filter(
      (approval) => approvalWordingKind(approval) === "command",
    ).length;
    return `${provider} wants to run ${plural(commands, "command")}`;
  }
  return `${provider} ${approvalPhrase(kind)}`;
}

/** "Claude asks 1 question: keep the spring animation, or cut to a fade?" */
function inputAskText(provider: string, inputs: NowBarInput["pendingUserInputs"]): string {
  const questions = inputs.flatMap((input) => input.questions);
  const [first] = questions;
  if (!first) return `${provider} asked you a question`;
  return `${provider} asks ${plural(questions.length, "question")}: ${first.question}`;
}

export function deriveNowBarState(input: NowBarInput): NowBarState {
  if (input.pendingApprovals.length > 0) {
    return {
      kind: "blocked",
      request: "approval",
      text: approvalAskText(input.provider, input.pendingApprovals),
      since: earliest(input.pendingApprovals.map((approval) => approval.createdAt)),
    };
  }
  if (input.pendingUserInputs.length > 0) {
    return {
      kind: "blocked",
      request: "input",
      text: inputAskText(input.provider, input.pendingUserInputs),
      since: earliest(input.pendingUserInputs.map((request) => request.createdAt)),
    };
  }
  if (input.isWorking) {
    const { agentState, planProgress } = input;
    if (agentState) {
      const status = formatRunningThreadStatus({
        agentState,
        planProgress: null,
        formatResetTime: input.formatResetTime ?? (() => ""),
      });
      return {
        kind: "working",
        status: status.label,
        mark:
          agentState.kind === "rate-limited"
            ? "usage-limit"
            : agentState.kind === "retrying"
              ? "retrying"
              : "live",
        progress: null,
        text: status.detail ?? input.currentAction,
        startedAt: input.workStartedAt,
      };
    }
    if (planProgress && planProgress.totalSteps > 0) {
      const step = Math.min(planProgress.completedSteps + 1, planProgress.totalSteps);
      return {
        kind: "working",
        status: "Working",
        mark: "live",
        progress: {
          completedSteps: planProgress.completedSteps,
          totalSteps: planProgress.totalSteps,
        },
        text: `Step ${step} of ${planProgress.totalSteps} · ${planProgress.step}`,
        startedAt: input.workStartedAt,
      };
    }
    // OpenCode never reports a plan, and plan progress is lost on a server
    // restart: the current action and the elapsed time carry the bar then.
    return {
      kind: "working",
      status: "Working",
      mark: "live",
      progress: null,
      text: input.currentAction,
      startedAt: input.workStartedAt,
    };
  }
  if (input.failure !== null) return { kind: "failed", text: input.failure };
  const turn = input.latestTurn;
  if (turn?.state === "completed" && turn.completedAt) {
    const startedMs = Date.parse(turn.startedAt ?? "");
    const completedMs = Date.parse(turn.completedAt);
    const diffStat = turn.diffStat;
    return {
      kind: "done",
      workedFor: Number.isNaN(startedMs) ? null : formatWorkedDuration(completedMs - startedMs),
      finishedAt: turn.completedAt,
      hasChanges: diffStat !== undefined && diffStat.insertions + diffStat.deletions > 0,
    };
  }
  return { kind: "hidden" };
}

/**
 * The ticking half of the now bar's "2m 10s · since 14:02". Past a day it
 * gives the start day instead ("since Tue"), so no number keeps growing.
 */
export function formatNowBarElapsed(
  startedAt: string,
  nowMs: number,
): { readonly elapsed: string } | { readonly day: string } | null {
  const startedMs = Date.parse(startedAt);
  if (Number.isNaN(startedMs)) return null;
  const elapsedMs = Math.max(0, nowMs - startedMs);
  if (elapsedMs >= DAY_MS) {
    const withinWeek = elapsedMs < 7 * DAY_MS;
    return {
      day: new Date(startedMs).toLocaleDateString(
        undefined,
        withinWeek ? { weekday: "short" } : { month: "short", day: "numeric" },
      ),
    };
  }
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return { elapsed: `${hours}h ${minutes}m ${seconds}s` };
  if (minutes > 0) return { elapsed: `${minutes}m ${seconds}s` };
  return { elapsed: `${seconds}s` };
}

/**
 * The message the failed bar's Retry sends again, or null when Retry would
 * repeat something already answered. Only a turn that itself ended in error
 * qualifies (a provider that crashed while idle leaves a completed turn), and
 * only your last message from that turn, or one sent after the last answered
 * turn. A message with attachments cannot be resent as text, so it gets none.
 */
export function selectRetryMessage<
  Message extends {
    readonly role: string;
    readonly text: string;
    readonly turnId?: TurnId | null | undefined;
    readonly attachments?: ReadonlyArray<unknown> | undefined;
  },
>(
  messages: ReadonlyArray<Message>,
  latestTurn: { readonly turnId: TurnId; readonly state: string } | null | undefined,
): Message | null {
  if (latestTurn?.state !== "error") return null;
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const message = messages[lastUserIndex];
  if (!message || !message.text.trim() || (message.attachments?.length ?? 0) > 0) return null;
  if (message.turnId === latestTurn.turnId) return message;
  if (message.turnId) return null;
  // Not yet bound to a turn: retry only if no other turn answered after it.
  const answeredAfter = messages
    .slice(lastUserIndex + 1)
    .some((later) => later.role === "assistant" && later.turnId !== latestTurn.turnId);
  return answeredAfter ? null : message;
}

/** "Worked 3m 40s · finished 14:06", or "Finished 14:06" when the start is unknown. */
export function doneSummary(workedFor: string | null, finishedClock: string): string {
  return workedFor === null
    ? `Finished ${finishedClock}`
    : `Worked ${workedFor} · finished ${finishedClock}`;
}

/**
 * The running turn's latest tool action in the timeline's own words
 * ("Running vp", "Editing apps/web/src/index.css"), or null while it only
 * thinks. The now bar names a file by its name alone ("Editing index.css").
 */
export function selectCurrentAction(
  entries: ReadonlyArray<WorkLogEntry>,
  runningTurnId: TurnId | null | undefined,
  workspaceRoot: string | undefined,
  fileName: "relative" | "base" = "relative",
): string | null {
  if (!runningTurnId) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.turnId !== runningTurnId || entry.tone !== "tool") continue;
    const label = liveWorkEntryLabel(
      entry,
      workspaceRoot,
      entry.toolLifecycleStatus === "inProgress",
      fileName,
    ).trim();
    return label === "" ? null : label;
  }
  return null;
}

/**
 * Distinct files the agent has changed in this thread, for "Changes so far ·
 * N files": every finished turn's checkpoint, plus the files the running
 * turn's edits logged before its checkpoint lands. Counted as the timeline's
 * "changed N files" counts them, so the two agree: only edits count, and an
 * edit that names no file counts as one.
 */
export function countChangedFiles(
  checkpoints: ReadonlyArray<Pick<OrchestrationCheckpointSummary, "files">>,
  runningEntries: ReadonlyArray<WorkLogEntry>,
  workspaceRoot: string | undefined,
): number {
  const paths = new Set<string>();
  for (const checkpoint of checkpoints) {
    for (const file of checkpoint.files)
      paths.add(formatWorkspaceRelativePath(file.path, workspaceRoot));
  }
  let unnamedEdits = 0;
  for (const entry of runningEntries) {
    if (entry.tone === "thinking" || toolGroupAction(entry) !== "edit") continue;
    const named = entry.changedFiles?.length
      ? entry.changedFiles
      : (entry.fileDiffStats ?? []).map((file) => file.path);
    if (named.length === 0) unnamedEdits += 1;
    for (const path of named) paths.add(formatWorkspaceRelativePath(path, workspaceRoot));
  }
  return paths.size + unnamedEdits;
}

const MAX_EARLIER_TURNS = 5;

/** "4m", "12m", "40s": whole minutes once past one, as a fact, never an estimate. */
function formatTurnLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : formatWorkedDuration(minutes * 60_000);
}

/**
 * The elapsed time's tooltip (F5, decision 7): how long this thread's earlier
 * turns took, oldest first, as plain facts ("Earlier turns: 4m, 12m, 2m").
 * Each turn runs from the message that started it to its last reply. Null
 * when there is no earlier turn to list.
 */
export function earlierTurnDurations(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }>,
  runningTurnId: TurnId | null,
): string | null {
  const durations: string[] = [];
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let turnId: TurnId | null = null;
  const close = () => {
    if (startedAt !== null && endedAt !== null && turnId !== null && turnId !== runningTurnId) {
      durations.push(formatTurnLength(endedAt - startedAt));
    }
  };
  for (const message of messages) {
    if (message.role === "user") {
      close();
      startedAt = Date.parse(message.createdAt);
      endedAt = null;
      turnId = null;
      continue;
    }
    if (startedAt === null || message.turnId === null) continue;
    const end = Date.parse(message.updatedAt);
    if (!Number.isFinite(end)) continue;
    turnId = message.turnId;
    endedAt = endedAt === null ? end : Math.max(endedAt, end);
  }
  close();
  if (durations.length === 0) return null;
  return `Earlier turns: ${durations.slice(-MAX_EARLIER_TURNS).join(", ")}`;
}
