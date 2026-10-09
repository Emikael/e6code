/**
 * deterministicResponder - closed answers served from app state, no model.
 *
 * Jev classifies; it never generates text. Exact greetings and lookups are
 * matched here before any network call. A Jev `local_fact` choice uses the
 * same templates for paraphrases the patterns miss. Anything outside the
 * set returns null and the turn falls back to the provider.
 *
 * @module deterministicResponder
 */
export interface DeterministicContext {
  readonly text: string;
  readonly threadTitle?: string;
  readonly projectName?: string;
}

const GREETING_PATTERN =
  /^(hi|hello|hey|yo|good\s?(morning|afternoon|evening)|thanks|thank you|bye|goodbye)[!.\s]*$/i;
const PROJECT_NAME_PATTERN =
  /\b(what('s| is) (the|this) project (called|name)|project name|which project)\b/i;
const THREAD_NAME_PATTERN =
  /\b(what('s| is) (the|this) thread (called|title|name)|thread (title|name))\b/i;

/** Reply for a known local fact, or null when the fact has no template or data. */
export const answerLocalFact = (fact: string, context: DeterministicContext): string | null => {
  switch (fact) {
    case "greeting":
      return "Hello! How can I help with your code today?";
    case "project_name":
      return context.projectName !== undefined
        ? `This project is called "${context.projectName}".`
        : null;
    case "thread_title":
      return context.threadTitle !== undefined
        ? `This thread is titled "${context.threadTitle}".`
        : null;
    default:
      return null;
  }
};

/** Answer text for an exact template, or null when the message is outside the set. */
export const answerDeterministic = (context: DeterministicContext): string | null => {
  const normalized = context.text.trim();
  if (GREETING_PATTERN.test(normalized)) return answerLocalFact("greeting", context);
  if (PROJECT_NAME_PATTERN.test(normalized)) return answerLocalFact("project_name", context);
  if (THREAD_NAME_PATTERN.test(normalized)) return answerLocalFact("thread_title", context);
  return null;
};
