import type { ServerProvider } from "@e6tools/contracts";

/**
 * "Split into subagents" is a new-thread option: offered only before the first
 * turn and only for a provider that can run parallel subagents. A draft keeps
 * its choice across provider switches, but it is only sent where it applies.
 */
export function resolveSubagentSplit(input: {
  readonly isNewThread: boolean;
  readonly provider: Pick<ServerProvider, "supportsSubagentSplit"> | null | undefined;
  readonly requested: boolean | undefined;
}): { readonly available: boolean; readonly enabled: boolean } {
  const available = input.isNewThread && input.provider?.supportsSubagentSplit === true;
  return { available, enabled: available && input.requested === true };
}
