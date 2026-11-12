import type { TurnId } from "@e6tools/contracts";

/** What the Next card offers after a finished turn (board 3, F6). */
export interface NextCardState {
  readonly turnId: TurnId;
  /** "3 files +66 −13"; null when the turn's checkpoint has not listed its files yet. */
  readonly fileCount: number | null;
  readonly insertions: number;
  readonly deletions: number;
}

/**
 * The Next card closes a turn that completed with changes: review them,
 * settle the thread, or ask for more. Nothing shows while the agent works or
 * waits on you, after a turn without changes, or once the thread is settled.
 */
export function deriveNextCard(input: {
  readonly latestTurn: {
    readonly turnId: TurnId;
    readonly state: string;
    readonly diffStat?: { readonly insertions: number; readonly deletions: number } | undefined;
  } | null;
  readonly isWorking: boolean;
  readonly waitingOnYou: boolean;
  readonly settled: boolean;
  readonly checkpoints: ReadonlyArray<{
    readonly turnId: TurnId;
    readonly files: ReadonlyArray<unknown>;
  }>;
}): NextCardState | null {
  const turn = input.latestTurn;
  if (!turn || turn.state !== "completed" || input.isWorking || input.waitingOnYou) return null;
  if (input.settled) return null;
  const diffStat = turn.diffStat;
  if (!diffStat || diffStat.insertions + diffStat.deletions === 0) return null;
  const checkpoint = input.checkpoints.find((candidate) => candidate.turnId === turn.turnId);
  return {
    turnId: turn.turnId,
    fileCount: checkpoint ? checkpoint.files.length : null,
    insertions: diffStat.insertions,
    deletions: diffStat.deletions,
  };
}

/** "3 files +66 −13", or "+66 −13" before the file list is known. */
export function formatNextCardChanges(state: NextCardState): string {
  const lines = `+${state.insertions} −${state.deletions}`;
  if (state.fileCount === null) return lines;
  return `${state.fileCount} ${state.fileCount === 1 ? "file" : "files"} ${lines}`;
}
