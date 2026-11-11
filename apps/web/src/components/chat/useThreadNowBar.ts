import { isThreadFailed } from "@e6tools/client-runtime/state/thread-attention";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { PROVIDER_DISPLAY_NAMES, type OrchestrationCheckpointSummary } from "@e6tools/contracts";
import { useMemo } from "react";

import type { PendingApproval, PendingUserInput, WorkLogEntry } from "../../session-logic";
import { threadNotificationFact } from "../../threadNotificationPolicy";
import {
  countChangedFiles,
  deriveNowBarState,
  selectCurrentAction,
  type NowBarState,
} from "./ThreadNowBar.logic";

const providerLabel = (name: string) =>
  (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[name];

/**
 * The open thread's now bar and the header's "Changes so far" count, from the
 * state ChatView already holds. Recomputes only when its inputs change; the
 * seconds tick inside the bar, not here.
 */
export function useThreadNowBar(input: {
  readonly shell: EnvironmentThreadShell | null;
  readonly isWorking: boolean;
  readonly workStartedAt: string | null;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly pendingApprovals: ReadonlyArray<PendingApproval>;
  readonly pendingUserInputs: ReadonlyArray<PendingUserInput>;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly workspaceRoot: string | undefined;
}): {
  readonly state: NowBarState;
  readonly currentAction: string | null;
  readonly changedFileCount: number;
} {
  const {
    shell,
    isWorking,
    workStartedAt,
    workLogEntries,
    pendingApprovals,
    pendingUserInputs,
    checkpoints,
    workspaceRoot,
  } = input;
  const runningTurnId = isWorking ? (shell?.latestTurn?.turnId ?? null) : null;
  const currentAction = useMemo(
    () => selectCurrentAction(workLogEntries, runningTurnId, workspaceRoot),
    [runningTurnId, workLogEntries, workspaceRoot],
  );
  const changedFileCount = useMemo(
    () =>
      countChangedFiles(
        checkpoints,
        runningTurnId === null
          ? []
          : workLogEntries.filter((entry) => entry.turnId === runningTurnId),
        workspaceRoot,
      ),
    [checkpoints, runningTurnId, workLogEntries, workspaceRoot],
  );
  const state = useMemo(() => {
    if (!shell) return { kind: "hidden" } as const;
    const providerName = shell.session?.providerName;
    return deriveNowBarState({
      isWorking,
      workStartedAt,
      planProgress: shell.planProgress,
      agentState: shell.agentState,
      currentAction,
      pendingApprovals,
      pendingUserInputs,
      provider: (providerName && providerLabel(providerName)) || "The agent",
      failure: isThreadFailed(shell)
        ? threadNotificationFact(shell, "failed", providerLabel)
        : null,
      latestTurn: shell.latestTurn,
    });
  }, [currentAction, isWorking, pendingApprovals, pendingUserInputs, shell, workStartedAt]);
  return { state, currentAction, changedFileCount };
}
