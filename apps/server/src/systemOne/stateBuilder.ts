/**
 * stateBuilder - packs a turn into a small hosted Jev state.
 *
 * `jev-1.13.0` accepts 32k tokens of state plus the longest question, and
 * 64k for the whole request. Accuracy falls when that state is full of
 * unrelated detail, so this module keeps a few thousand estimated tokens:
 * the live message, a short recent exchange, and the names the local
 * handlers can answer. Token counts are a chars/4 heuristic. The router
 * skips Jev when `lastMessage` itself does not fit, so a cut-off question
 * is never classified.
 *
 * @module stateBuilder
 */
import type { ChoiceQuestion, NoulQuestion, Question } from "./judgmentTypes.ts";

/** Local filter, well under the model's 32k state limit. */
export const MAX_STATE_TOKENS = 4096;
/** Recent exchange kept beside the live message. */
export const RECENT_TURNS_TOKEN_BUDGET = 1024;
/** Each Choice option stays short; the model allows much longer descriptions. */
export const MAX_OPTION_TOKENS = 192;
/** Model recommendation: keep Choice option counts below this. */
export const MAX_CHOICE_OPTIONS = 20;

/** Rough token estimate; the hosted API tokenizes the real request. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const truncateToTokenBudget = (text: string, budgetTokens: number): string => {
  if (estimateTokens(text) <= budgetTokens) return text;
  return text.slice(0, budgetTokens * 4);
};

export interface TurnClassifyInput {
  readonly lastMessage: string;
  readonly threadTitle?: string;
  readonly projectName?: string;
  readonly turnIndex?: number;
  /** Prior user and assistant text, excluding the live message. */
  readonly recentTurns?: string;
}

export interface RecentTurnMessage {
  readonly id?: string;
  readonly role: string;
  readonly text: string;
}

/**
 * The previous user message and assistant reply, in conversation order.
 * The live message is omitted so the judgment is about the new turn.
 */
export const formatRecentTurns = (
  messages: ReadonlyArray<RecentTurnMessage>,
  excludeMessageId?: string,
): string => {
  const prior = messages.filter(
    (message) =>
      message.id !== excludeMessageId &&
      (message.role === "user" || message.role === "assistant") &&
      message.text.trim().length > 0,
  );
  const lastUser = prior.findLast((message) => message.role === "user");
  const lastAssistant = prior.findLast((message) => message.role === "assistant");
  const ordered = [lastUser, lastAssistant]
    .filter((message): message is RecentTurnMessage => message !== undefined)
    .sort((left, right) => prior.indexOf(left) - prior.indexOf(right));
  return ordered.map((message) => `${message.role}: ${message.text.trim()}`).join("\n");
};

const metadataState = (input: TurnClassifyInput): Record<string, string | number> => {
  const state: Record<string, string | number> = {};
  if (input.threadTitle !== undefined) {
    state.threadTitle = truncateToTokenBudget(input.threadTitle, 24);
  }
  if (input.projectName !== undefined) {
    state.projectName = truncateToTokenBudget(input.projectName, 16);
  }
  if (input.turnIndex !== undefined) state.turnIndex = input.turnIndex;
  return state;
};

const fitLastMessage = (metadata: Record<string, string | number>, lastMessage: string): string => {
  const overhead = estimateTokens(JSON.stringify({ ...metadata, lastMessage: "" }));
  return truncateToTokenBudget(lastMessage, Math.max(1, MAX_STATE_TOKENS - overhead));
};

const withinBudget = (state: Record<string, string | number>): Record<string, string | number> => {
  const lastMessage = state.lastMessage;
  if (
    typeof lastMessage !== "string" ||
    lastMessage.length === 0 ||
    estimateTokens(JSON.stringify(state)) <= MAX_STATE_TOKENS
  ) {
    return state;
  }
  return withinBudget({
    ...state,
    lastMessage: lastMessage.slice(0, Math.max(0, lastMessage.length - 64)),
  });
};

/**
 * Compact JSON state for one turn. Carries the latest message, a short
 * prior exchange, and the names local handlers can answer. Never secrets.
 * The live message is kept whole whenever it fits; only the excerpt is
 * dropped to make room. A message that still does not fit is truncated,
 * which the router treats as too long to classify.
 */
export const buildClassifyState = (input: TurnClassifyInput): Record<string, string | number> => {
  const withoutRecent = metadataState(input);
  const alone = withinBudget({
    ...withoutRecent,
    lastMessage: fitLastMessage(withoutRecent, input.lastMessage),
  });
  if (alone.lastMessage !== input.lastMessage) return alone;
  if (input.recentTurns === undefined || input.recentTurns.length === 0) return alone;
  let excerpt = truncateToTokenBudget(input.recentTurns, RECENT_TURNS_TOKEN_BUDGET);
  while (excerpt.length > 0) {
    const candidate = { ...withoutRecent, lastMessage: input.lastMessage, recentTurns: excerpt };
    if (estimateTokens(JSON.stringify(candidate)) <= MAX_STATE_TOKENS) return candidate;
    excerpt = excerpt.slice(0, Math.max(0, excerpt.length - 64));
  }
  return alone;
};

export const ROUTE_QUESTION_IDS = [
  "handling_route",
  "local_fact",
  "depends_on_earlier_turns",
  "is_sensitive_or_risky",
] as const;

/** Precise question map, so `systemOne` answers come back typed per id. */
export type RouteQuestions = {
  handling_route: ChoiceQuestion;
  local_fact: ChoiceQuestion;
  depends_on_earlier_turns: NoulQuestion;
  is_sensitive_or_risky: NoulQuestion;
};

/**
 * One request, four judgments. The route Choice names a handler the app
 * actually runs. `local_fact` is read only when that route is
 * `local_lookup`. The two Nouls gate trimming and the provider fallback.
 */
export const buildRouteQuestions = () =>
  ({
    handling_route: {
      type: "choice",
      instructions:
        "How should `lastMessage` be handled, given `recentTurns`, `projectName`, and `threadTitle`?",
      criteria: {
        local_lookup:
          "A greeting, thanks, or goodbye, or a question asking only for the project name or thread title already present in state",
        trimmed_provider:
          "A question that does not need earlier turns, repository reads, file edits, tool calls, or attached composer records",
        full_provider:
          "Needs files, tools, earlier turns, or attached composer records, or the request is ambiguous",
      },
    },
    local_fact: {
      type: "choice",
      instructions:
        "If `lastMessage` is only a greeting or a lookup of a name already in state, which fact does it ask for? Otherwise choose none.",
      criteria: {
        greeting: "A greeting, thanks, or goodbye with no other request",
        project_name: "Asks what this project is called, answered by `projectName`",
        thread_title: "Asks what this thread is called, answered by `threadTitle`",
        none: "Not only a greeting or a name lookup",
      },
    },
    depends_on_earlier_turns: {
      type: "noul",
      instructions:
        "Does answering `lastMessage` depend on `recentTurns` or on composer context from earlier in the thread?",
      criteria: {
        true: "The message refers to earlier turns, prior decisions, or attached context that is not restated in `lastMessage`",
        false:
          "`lastMessage` stands alone and does not need earlier turns or attached composer records",
      },
    },
    is_sensitive_or_risky: {
      type: "noul",
      instructions: "Does `lastMessage` involve secrets, credentials, or destructive operations?",
      criteria: {
        true: "It asks for secrets or credentials, or it requests a destructive or irreversible operation",
        false: "It does not involve secrets, credentials, or destructive operations",
      },
    },
  }) as const satisfies RouteQuestions;

/** Fails a question set that would overflow the local option budget. */
export const questionsWithinBudget = (questions: Readonly<Record<string, Question>>): boolean =>
  Object.values(questions).every((question) => {
    if (question.type === "choice") {
      const options = Object.entries(question.criteria);
      if (options.length > MAX_CHOICE_OPTIONS) return false;
      return options.every(([, description]) =>
        description === null ? true : estimateTokens(description) <= MAX_OPTION_TOKENS,
      );
    }
    if (question.type === "score") {
      return (
        question.criteria.length >= 2 &&
        question.criteria.every((level) => estimateTokens(level) <= MAX_OPTION_TOKENS)
      );
    }
    return true;
  });
