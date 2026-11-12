import {
  PENDING_REQUEST_QUESTION_MAX_CHARS,
  type ThreadPendingRequestSummary,
} from "@e6tools/contracts";

/** An open approval as the projection stores it: what its request activity named. */
export interface PendingApprovalKindRow {
  readonly requestKind: string | null;
  readonly requestType: string | null;
}

/** An open user-input request: the question texts it asked, in order. */
export interface OpenUserInputRequest {
  readonly questions: ReadonlyArray<string>;
}

/**
 * The approval kind clients phrase ("wants to run 1 command"). Activities
 * carry `requestKind` when the adapter's request type maps to one; older
 * rows only carry the native `requestType`. Anything else, such as an ACP
 * tool call of kind "other", stays unnamed and clients use generic wording.
 */
function approvalKindOf(row: PendingApprovalKindRow): string | null {
  if (row.requestKind) return row.requestKind;
  switch (row.requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
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

/** One line, cut to the shell's limit with an ellipsis. */
export function truncatePendingQuestion(text: string): string | null {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length === 0) return null;
  if (line.length <= PENDING_REQUEST_QUESTION_MAX_CHARS) return line;
  return `${line.slice(0, PENDING_REQUEST_QUESTION_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * The shell's pending-request summary, from the open approvals and user-input
 * requests, each oldest first. Null when nothing is pending. Kept to counts,
 * one kind and one short question: the thread list goes to every client.
 */
export function summarizePendingRequests(input: {
  readonly approvals: ReadonlyArray<PendingApprovalKindRow>;
  readonly userInputs: ReadonlyArray<OpenUserInputRequest>;
}): ThreadPendingRequestSummary | null {
  const { approvals, userInputs } = input;
  if (approvals.length === 0 && userInputs.length === 0) return null;
  const kinds = approvals.map(approvalKindOf);
  const approvalKind = kinds[0] ?? null;
  const questionCount = userInputs.reduce((sum, request) => sum + request.questions.length, 0);
  const firstQuestion = userInputs[0]?.questions[0];
  const question = firstQuestion === undefined ? null : truncatePendingQuestion(firstQuestion);
  return {
    approvalCount: approvals.length,
    ...(approvalKind !== null
      ? {
          approvalKind,
          approvalKindCount: kinds.filter((kind) => kind === approvalKind).length,
        }
      : {}),
    userInputCount: userInputs.length,
    questionCount,
    ...(question !== null ? { question } : {}),
  };
}
