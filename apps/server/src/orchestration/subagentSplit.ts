import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@e6tools/contracts";

/**
 * Provider-only instruction behind the new-thread "Split into subagents"
 * switch. Providers have no structured "fan out" option, so the request rides
 * on the turn's input; the user's stored message keeps the text as typed.
 */
export const SUBAGENT_SPLIT_INSTRUCTION =
  "Split this task into independent parts and run them as parallel subagents, " +
  "using at most 4 subagents. Give each subagent a self-contained brief with the " +
  "context it needs. When they finish, integrate their results, resolve any " +
  "conflicts between them, and check the combined result before you reply. If the " +
  "task has no independent parts, do it directly and say why.";

export type SubagentSplitOutcome = "not-requested" | "applied" | "unsupported" | "too-long";

/**
 * Appends the split instruction to a turn's provider input. The input stays
 * unchanged when the split was not requested, the provider cannot run
 * subagents, or the instruction would push the input past the send limit; the
 * outcome says which, so the caller can record it.
 */
export function withSubagentSplitInstruction(input: {
  readonly text: string;
  readonly splitIntoSubagents: boolean;
  readonly providerSupportsSplit: boolean;
}): { readonly text: string; readonly outcome: SubagentSplitOutcome } {
  if (!input.splitIntoSubagents) return { text: input.text, outcome: "not-requested" };
  if (!input.providerSupportsSplit) return { text: input.text, outcome: "unsupported" };
  const trimmed = input.text.trim();
  const next =
    trimmed.length > 0 ? `${trimmed}\n\n${SUBAGENT_SPLIT_INSTRUCTION}` : SUBAGENT_SPLIT_INSTRUCTION;
  return next.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? { text: next, outcome: "applied" }
    : { text: input.text, outcome: "too-long" };
}
