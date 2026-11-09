import type { ThreadAgentState } from "@e6tools/contracts";

const positiveInt = (value: number | null | undefined): number | undefined =>
  value !== null && value !== undefined && Number.isInteger(value) && value >= 1
    ? value
    : undefined;

/**
 * A retry state from a provider's native counters. Counters a provider does
 * not report, or reports out of range, are left out so the label falls back
 * to plain "Retrying request…".
 */
export function retryingAgentState(
  attempt: number | null | undefined,
  maxAttempts?: number | null,
): ThreadAgentState {
  const safeAttempt = positiveInt(attempt);
  const safeMax = positiveInt(maxAttempts);
  return {
    kind: "retrying",
    ...(safeAttempt !== undefined ? { attempt: safeAttempt } : {}),
    ...(safeMax !== undefined && (safeAttempt === undefined || safeAttempt <= safeMax)
      ? { maxAttempts: safeMax }
      : {}),
  };
}
