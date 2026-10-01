/**
 * deterministicResponder - v0 answers served from app state, no LLM.
 *
 * Laya classifies; it never generates text. So a deterministic route still
 * needs words from somewhere: this closed set of templates answered from
 * data the reactor already holds (thread title, project name). Anything
 * outside the set returns null and the turn falls back to the full LLM.
 * Grow the set in calibration (T7), never by guessing.
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

/** Answer text, or null when no template covers the turn. */
export const answerDeterministic = (context: DeterministicContext): string | null => {
  const normalized = context.text.trim();
  if (GREETING_PATTERN.test(normalized)) {
    return "Hello! How can I help with your code today?";
  }
  if (PROJECT_NAME_PATTERN.test(normalized) && context.projectName !== undefined) {
    return `This project is called "${context.projectName}".`;
  }
  if (THREAD_NAME_PATTERN.test(normalized) && context.threadTitle !== undefined) {
    return `This thread is titled "${context.threadTitle}".`;
  }
  return null;
};
