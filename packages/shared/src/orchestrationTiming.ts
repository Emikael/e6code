type LatestTurnTiming = {
  readonly turnId: string | null;
  /** Set when the turn is created; `startedAt` waits for the provider. */
  readonly requestedAt?: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

type SessionActivityState = {
  readonly orchestrationStatus: string;
  readonly activeTurnId?: string | null;
};

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) {
    const tenths = Math.round(durationMs / 100) / 10;
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`;
  }
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const totalSeconds = Math.round(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

type TimedReasoningMessage = {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly streaming: boolean;
};

/** Below this, the span is timestamp noise (an imported trace, a flush), not thinking. */
const MIN_REASONING_DURATION_MS = 1_000;

/**
 * The label for one or more settled thinking blocks: "Thought for 12s (×3)".
 *
 * The server stamps a reasoning message's `createdAt` when the block opened and
 * its `updatedAt` when the block closed, so each span is the model's time.
 * Spans are summed, not measured end to end, so tool calls between blocks do
 * not count as thinking. A block still streaming, or a span too short to mean
 * anything, leaves the plain "Thought" label.
 */
export function formatThoughtLabel(messages: ReadonlyArray<TimedReasoningMessage>): string {
  const count = messages.length > 1 ? ` (×${messages.length})` : "";
  let totalMs = 0;
  for (const message of messages) {
    if (message.streaming) return `Thought${count}`;
    const span = Date.parse(message.updatedAt) - Date.parse(message.createdAt);
    if (Number.isFinite(span) && span > 0) totalMs += span;
  }
  return totalMs >= MIN_REASONING_DURATION_MS
    ? `Thought for ${formatDuration(totalMs)}${count}`
    : `Thought${count}`;
}

function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

/**
 * When the working indicator should be counting, and from when.
 *
 * `requestedAt` is the floor for an unsettled turn. The projector only stamps
 * `startedAt` in the same update that moves the session to "running", so while
 * the provider spins up (session "starting") a requested turn has no
 * `startedAt` at all — and returning null there blinks the indicator out for
 * the whole spin-up. A settled turn still falls through to `sendStartedAt`, so
 * this cannot leave the indicator counting after the work is done.
 */
export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  if (session?.activeTurnId && session.activeTurnId !== latestTurn?.turnId) {
    return sendStartedAt;
  }
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? latestTurn?.requestedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}
