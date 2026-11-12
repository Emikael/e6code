import {
  ApprovalRequestId,
  type OrchestrationThreadActivity,
  ProviderApprovalOption,
  ProviderRequestKind,
  type ThreadPendingRequestSummary,
  UserInputQuestion,
} from "@e6tools/contracts";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: ProviderRequestKind;
  readonly createdAt: string;
  readonly detail?: string;
  readonly appName?: string;
  readonly options?: ReadonlyArray<ProviderApprovalOption>;
  /** The subagent that asked: its task id. Absent for the main agent. */
  readonly agentId?: string;
}

export interface PendingUserInput {
  readonly requestId: ApprovalRequestId;
  readonly createdAt: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
  /** Async questions can be dismissed without a reply; native callbacks cannot. */
  readonly dismissible: boolean;
  /** The subagent that asked: its task id. Absent for the main agent. */
  readonly agentId?: string;
}

/**
 * What a named subagent is asking for, after its title: "Share link API
 * wants to run a command". Shared so every approval surface says the same.
 */
export const SUBAGENT_APPROVAL_PHRASE: Readonly<Record<ProviderRequestKind, string>> = {
  command: "wants to run a command",
  "file-read": "wants to read a file",
  "file-change": "wants to change files",
  "mcp-elicitation": "wants app access",
  permission: "wants an app permission",
};

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

/**
 * What a blocked thread's agent wants, from the shell's request summary:
 * "Codex wants to run 1 command", "Claude wants to change files". Without a
 * summary (an older server, or a request the adapter could not name) it says
 * "Codex is waiting for your approval". No trailing period.
 */
export function describePendingApprovalAsk(
  provider: string,
  summary: ThreadPendingRequestSummary | undefined,
): string {
  const kind = summary?.approvalKind;
  if (kind === "command") {
    return `${provider} wants to run ${plural(summary?.approvalKindCount ?? 1, "command")}`;
  }
  if (kind !== undefined && isProviderRequestKind(kind)) {
    return `${provider} ${SUBAGENT_APPROVAL_PHRASE[kind]}`;
  }
  return `${provider} is waiting for your approval`;
}

/**
 * What a blocked thread's agent asks, from the shell's request summary:
 * "Claude asks 1 question: keep the spring animation, or cut to a fade?".
 * Without the question text it says "Claude asked you a question".
 * `withQuestion: false` leaves the text out ("Claude asks 1 question"), for
 * system notifications, which can show on a lock screen.
 */
export function describePendingQuestionAsk(
  provider: string,
  summary: ThreadPendingRequestSummary | undefined,
  options: { readonly withQuestion?: boolean } = {},
): string {
  if (!summary?.question) return `${provider} asked you a question`;
  const count = `${provider} asks ${plural(Math.max(1, summary.questionCount), "question")}`;
  return options.withQuestion === false ? count : `${count}: ${summary.question}`;
}

/** What one shown request asks for, after the agent's name: "wants to run this command". */
const SHOWN_APPROVAL_PHRASE: Readonly<Record<ProviderRequestKind, string>> = {
  command: "wants to run this command",
  "file-read": "wants to read this file",
  "file-change": "wants to make this change",
  "mcp-elicitation": "wants app access",
  permission: "wants this app permission",
};

/**
 * The headline for one approval shown on its own. Alone it reads like the
 * shell's summary ("Codex wants to run 1 command"); among several it names
 * the one shown and its place, so it never reads like approve-all:
 * "Codex wants to run this command · 1 of 2". No trailing period.
 */
export function describeShownApprovalAsk(
  provider: string,
  requestKind: ProviderRequestKind,
  position: { readonly index: number; readonly total: number },
): string {
  if (position.total <= 1) {
    return requestKind === "command"
      ? `${provider} wants to run 1 command`
      : `${provider} ${SUBAGENT_APPROVAL_PHRASE[requestKind]}`;
  }
  return `${provider} ${SHOWN_APPROVAL_PHRASE[requestKind]} · ${position.index + 1} of ${position.total}`;
}

/** What a subagent is blocked on: the oldest pending request that names it. */
export type SubagentUserRequest =
  | {
      readonly kind: "approval";
      readonly requestKind: ProviderRequestKind;
      readonly detail?: string;
    }
  | { readonly kind: "question"; readonly question: string };

/**
 * The pending requests that name a subagent, keyed by its task id. When one
 * subagent has several, the oldest wins: it is the one the composer shows.
 */
export function subagentUserRequests(requests: {
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly userInputs: ReadonlyArray<PendingUserInput>;
}): ReadonlyMap<string, SubagentUserRequest> {
  const byAgent = new Map<string, { createdAt: string; request: SubagentUserRequest }>();
  const offer = (agentId: string | undefined, createdAt: string, request: SubagentUserRequest) => {
    if (!agentId) return;
    const current = byAgent.get(agentId);
    if (!current || createdAt < current.createdAt) byAgent.set(agentId, { createdAt, request });
  };
  for (const approval of requests.approvals) {
    offer(approval.agentId, approval.createdAt, {
      kind: "approval",
      requestKind: approval.requestKind,
      ...(approval.detail ? { detail: approval.detail } : {}),
    });
  }
  for (const input of requests.userInputs) {
    const question = input.questions[0]?.question.trim();
    offer(input.agentId, input.createdAt, { kind: "question", question: question || "Question" });
  }
  return new Map([...byAgent].map(([agentId, entry]) => [agentId, entry.request]));
}

/** Verb before a short request detail on a subagent row: "wants to run `vp test`". */
const SUBAGENT_REQUEST_VERB: Partial<Record<ProviderRequestKind, string>> = {
  command: "wants to run",
  "file-read": "wants to read",
  "file-change": "wants to change",
};

/**
 * A blocked subagent's activity line. `code` is the command or path when the
 * request carried one, for rendering in monospace after `text`.
 */
export function describeSubagentUserRequest(request: SubagentUserRequest): {
  readonly text: string;
  readonly code: string | null;
} {
  if (request.kind === "question") return { text: `asks: ${request.question}`, code: null };
  const verb = SUBAGENT_REQUEST_VERB[request.requestKind];
  if (request.detail && verb) return { text: verb, code: request.detail };
  return { text: SUBAGENT_APPROVAL_PHRASE[request.requestKind], code: request.detail ?? null };
}

const isRequestId = Schema.is(ApprovalRequestId);
const isProviderRequestKind = Schema.is(ProviderRequestKind);
const isProviderApprovalOption = Schema.is(ProviderApprovalOption);
const QuestionOption = Schema.Struct({
  ...UserInputQuestion.fields.options.value.fields,
  label: Schema.String,
});
const isQuestionOption = Schema.is(QuestionOption);
// Native question IDs and option labels can be answer keys. Do not trim them.
const decodeQuestion = Schema.decodeUnknownOption(
  Schema.Struct({
    ...UserInputQuestion.fields,
    id: Schema.String,
    header: Schema.String,
    question: Schema.String,
    options: Schema.Array(QuestionOption),
  }),
);

/** Older activities use native request types instead of a request kind. */
export function requestKindFromRequestType(requestType: unknown): ProviderRequestKind | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    case "mcp_elicitation_approval":
      return "mcp-elicitation";
    case "permission_approval":
      return "permission";
    default:
      return null;
  }
}

function parseQuestions(value: unknown): UserInputQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((question) => {
    if (!Predicate.isObject(question) || !Array.isArray(question.options)) return [];
    const options = question.options.filter(isQuestionOption);
    if (options.length === 0 && question.allowCustomAnswer === false) return [];
    const parsed = decodeQuestion({
      id: question.id,
      header: question.header,
      question: question.question,
      options,
      multiSelect: question.multiSelect === true,
      ...(typeof question.allowCustomAnswer === "boolean"
        ? { allowCustomAnswer: question.allowCustomAnswer }
        : {}),
    });
    return Option.isSome(parsed) ? [parsed.value] : [];
  });
}

const requestActivityKinds = new Set([
  "approval.requested",
  "approval.resolved",
  "provider.approval.respond.failed",
  "user-input.requested",
  "user-input.resolved",
  "provider.user-input.respond.failed",
]);

// The server reports a stale or unknown request through the failure text.
// A failed reply with any other text stays open so the user can retry.
const staleRequestFailureDetails = {
  "provider.approval.respond.failed": [
    "stale pending approval request",
    "unknown pending approval request",
    "unknown pending permission request",
    "unknown pending codex approval request",
  ],
  "provider.user-input.respond.failed": [
    "stale pending user-input request",
    "unknown pending user-input request",
    "unknown pending user input request",
    "unknown pending codex user input request",
  ],
} as const;

function isStaleRequestFailure(
  kind: keyof typeof staleRequestFailureDetails,
  payload: Record<string, unknown>,
): boolean {
  const detail = typeof payload.detail === "string" ? payload.detail.toLowerCase() : "";
  return staleRequestFailureDetails[kind].some((fragment) => detail.includes(fragment));
}

/** Reduces request state once for web, desktop, and mobile. Layout stays with each client. */
export function derivePendingRequests(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  const approvals = new Map<ApprovalRequestId, PendingApproval>();
  const userInputs = new Map<ApprovalRequestId, PendingUserInput>();
  const closedApprovals = new Set<ApprovalRequestId>();
  const closedUserInputs = new Set<ApprovalRequestId>();

  // Request IDs are unique. A terminal event stays final even when provider
  // sequences and server-generated activities arrive in a different order.
  for (const activity of activities) {
    if (!requestActivityKinds.has(activity.kind)) continue;
    const payload = Predicate.isObject(activity.payload) ? activity.payload : undefined;
    if (!payload || !isRequestId(payload.requestId)) continue;
    const requestId = payload.requestId;

    if (activity.kind === "approval.requested") {
      if (
        closedApprovals.has(requestId) ||
        payload.requestType === "tool_user_input" ||
        payload.requestType === "auth_tokens_refresh"
      ) {
        continue;
      }
      const requestKind = isProviderRequestKind(payload.requestKind)
        ? payload.requestKind
        : requestKindFromRequestType(payload.requestType);
      const options = Array.isArray(payload.options)
        ? payload.options.filter(isProviderApprovalOption)
        : [];
      approvals.set(requestId, {
        requestId,
        // Older OpenCode approvals do not always include a recognized kind.
        requestKind: requestKind ?? "command",
        createdAt: activity.createdAt,
        ...(typeof payload.detail === "string" && payload.detail ? { detail: payload.detail } : {}),
        ...(typeof payload.appName === "string" && payload.appName
          ? { appName: payload.appName }
          : {}),
        ...(options.length > 0 ? { options } : {}),
        ...(typeof payload.agentId === "string" && payload.agentId
          ? { agentId: payload.agentId }
          : {}),
      });
    } else if (activity.kind === "user-input.requested") {
      if (closedUserInputs.has(requestId)) continue;
      const questions = parseQuestions(payload.questions);
      if (questions.length === 0) continue;
      userInputs.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
        dismissible: payload.responseMode === "message",
        ...(typeof payload.agentId === "string" && payload.agentId
          ? { agentId: payload.agentId }
          : {}),
      });
    } else if (
      activity.kind === "approval.resolved" ||
      (activity.kind === "provider.approval.respond.failed" &&
        isStaleRequestFailure(activity.kind, payload))
    ) {
      closedApprovals.add(requestId);
      approvals.delete(requestId);
    } else if (
      activity.kind === "user-input.resolved" ||
      (activity.kind === "provider.user-input.respond.failed" &&
        isStaleRequestFailure(activity.kind, payload))
    ) {
      closedUserInputs.add(requestId);
      userInputs.delete(requestId);
    }
  }

  const byCreatedAt = (
    left: { readonly createdAt: string },
    right: { readonly createdAt: string },
  ) => left.createdAt.localeCompare(right.createdAt);
  return {
    approvals: [...approvals.values()].sort(byCreatedAt),
    userInputs: [...userInputs.values()].sort(byCreatedAt),
  };
}
