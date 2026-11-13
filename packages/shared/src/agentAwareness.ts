import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ThreadId,
} from "@e6tools/contracts";

import { formatDuration } from "./orchestrationTiming.ts";

export type AgentAwarenessPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentAwarenessState {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly headline: string;
  readonly detail?: string;
  readonly modelTitle: string;
  readonly updatedAt: string;
  readonly deepLink: string;
}

export interface ProjectThreadAwarenessInput {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "title">;
  readonly thread: Pick<
    OrchestrationThreadShell,
    | "id"
    | "title"
    | "modelSelection"
    | "session"
    | "latestTurn"
    | "updatedAt"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
  > &
    Partial<Pick<OrchestrationThreadShell, "pendingRequestSummary">>;
}

function buildAgentAwarenessDeepLink(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): string {
  return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

export function projectThreadAwareness(
  input: ProjectThreadAwarenessInput,
): AgentAwarenessState | null {
  const { environmentId, project, thread } = input;
  const phase = resolveThreadAwarenessPhase(thread);
  if (!phase) {
    return null;
  }

  const detail = detailForPhase(phase, thread);
  return {
    environmentId,
    threadId: thread.id,
    projectTitle: project.title,
    threadTitle: thread.title,
    phase,
    headline: headlineForPhase(phase),
    ...(detail === undefined ? {} : { detail }),
    modelTitle: thread.modelSelection.model,
    updatedAt: thread.updatedAt,
    deepLink: buildAgentAwarenessDeepLink({ environmentId, threadId: thread.id }),
  };
}

function resolveThreadAwarenessPhase(
  thread: ProjectThreadAwarenessInput["thread"],
): AgentAwarenessPhase | null {
  if (thread.hasPendingApprovals) {
    return "waiting_for_approval";
  }
  if (thread.hasPendingUserInput) {
    return "waiting_for_input";
  }
  // The clients' failed rule: a live session hides an older failure, because
  // the agent is already trying again.
  const live = thread.session?.status === "running" || thread.session?.status === "starting";
  if (!live && (thread.session?.status === "error" || thread.latestTurn?.state === "error")) {
    return "failed";
  }
  if (thread.session?.status === "starting") {
    return "starting";
  }
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return "running";
  }
  if (thread.latestTurn?.state === "completed") {
    return "completed";
  }
  // A turn that finished can still read as "interrupted" here: session
  // teardown settles still-running turns by session status, and that write
  // can race the turn.completed one. completedAt survives the race — a turn
  // that has a completion timestamp finished, whatever the state column says.
  // Without this, quick finish-then-teardown threads resolve to null
  // persistently and get tombstoned instead of published as completed.
  if (thread.latestTurn?.state === "interrupted" && thread.latestTurn.completedAt !== null) {
    return "completed";
  }
  // Threads whose turns never produce a checkpoint (no code changes) have no
  // materialized latestTurn in the shell at all, and the session-set
  // projection clears latest_turn_id the moment the session settles. The
  // session status is then the only surviving completion signal: a live
  // session at "ready"/"idle" with nothing pending and nothing running means
  // the agent finished and is waiting for the next prompt — Done.
  if (thread.session?.status === "ready" || thread.session?.status === "idle") {
    return "completed";
  }
  return null;
}

// Blocked, failed and finished read like the web and desktop notifications,
// so a push and a desktop alert for one event say the same thing.
function headlineForPhase(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "starting":
      return "Starting agent";
    case "running":
      return "Agent is working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Input needed";
    case "completed":
      return "Thread completed";
    case "failed":
      return "Thread failed";
    case "stale":
      return "Update delayed";
  }
}

// What a named request asks for, after the agent's name. Worded as the
// clients word it (client-runtime `describePendingApprovalAsk`; a test there
// keeps the two in step).
const APPROVAL_PHRASE: Readonly<Record<string, string>> = {
  "file-read": "wants to read a file",
  "file-change": "wants to change files",
  "mcp-elicitation": "wants app access",
  permission: "wants an app permission",
};

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

/**
 * The one fact a blocked push carries (F2): "Codex wants to run 1 command",
 * "Claude asks 1 question". Never the question itself: a push can show on a
 * lock screen, and no client puts it in a system notification.
 */
export function describeAwarenessAsk(
  phase: "waiting_for_approval" | "waiting_for_input",
  thread: Pick<OrchestrationThreadShell, "session"> &
    Partial<Pick<OrchestrationThreadShell, "pendingRequestSummary">>,
): string {
  const providerName = thread.session?.providerName;
  const agent =
    (providerName &&
      (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[providerName]) ||
    "The agent";
  const summary = thread.pendingRequestSummary;
  if (phase === "waiting_for_input") {
    return summary?.question
      ? `${agent} asks ${plural(Math.max(1, summary.questionCount), "question")}`
      : `${agent} asked you a question`;
  }
  const kind = summary?.approvalKind;
  if (kind === "command") {
    return `${agent} wants to run ${plural(summary?.approvalKindCount ?? 1, "command")}`;
  }
  const phrase = kind === undefined ? undefined : APPROVAL_PHRASE[kind];
  return `${agent} ${phrase ?? "is waiting for your approval"}`;
}

/** How long the finished turn ran: "worked 3m 40s", or null without both times. */
function workedFor(latestTurn: OrchestrationThreadShell["latestTurn"]): string | null {
  const startedMs = Date.parse(latestTurn?.startedAt ?? "");
  const completedMs = Date.parse(latestTurn?.completedAt ?? "");
  if (Number.isNaN(startedMs) || Number.isNaN(completedMs) || completedMs < startedMs) return null;
  return `worked ${formatDuration(completedMs - startedMs)}`;
}

// The body under the thread's title is one fact (F2), or nothing.
function detailForPhase(
  phase: AgentAwarenessPhase,
  thread: ProjectThreadAwarenessInput["thread"],
): string | undefined {
  if (phase === "waiting_for_approval" || phase === "waiting_for_input") {
    return describeAwarenessAsk(phase, thread);
  }
  if (phase === "failed") {
    return thread.session?.lastError ?? undefined;
  }
  if (phase === "completed") {
    return workedFor(thread.latestTurn) ?? undefined;
  }
  if (phase === "running" && thread.session?.providerName) {
    return `${thread.session.providerName} is active.`;
  }
  return undefined;
}
