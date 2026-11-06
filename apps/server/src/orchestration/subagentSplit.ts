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

/**
 * Appends the split instruction to a turn's provider input. Leaves the input
 * unchanged when the split was not requested, the provider cannot run
 * subagents, or the instruction would push the input past the send limit.
 */
export function withSubagentSplitInstruction(input: {
  readonly text: string;
  readonly splitIntoSubagents: boolean;
  readonly providerSupportsSplit: boolean;
}): string {
  if (!input.splitIntoSubagents || !input.providerSupportsSplit) return input.text;
  const trimmed = input.text.trim();
  const next =
    trimmed.length > 0 ? `${trimmed}\n\n${SUBAGENT_SPLIT_INSTRUCTION}` : SUBAGENT_SPLIT_INSTRUCTION;
  return next.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS ? next : input.text;
}
