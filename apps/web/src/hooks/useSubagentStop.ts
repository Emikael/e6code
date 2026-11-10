/**
 * Stops one subagent while the turn runs on, from the Overview's row menu,
 * its detail card, or the thread.stopSubagent shortcut. A stop stays pending
 * until the provider settles the subagent; a failure the server records for
 * the request comes back as a toast.
 */
import {
  CommandId,
  type EnvironmentId,
  type OrchestrationThreadActivity,
  type ThreadId,
} from "@e6tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import {
  type AgentPanelModel,
  findSubagent,
  findSubagentStopFailure,
  isActiveSubagentStatus,
} from "@e6tools/client-runtime/state/subagentRuntime";
import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";

import { toastManager } from "~/components/ui/toast";
import { randomUUID } from "~/lib/utils";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

type PendingStops = Readonly<Record<string, string>>;

interface SubagentStopState {
  /** Stop command ids waiting on the provider, by thread key then subagent id. */
  readonly pendingByThreadKey: Readonly<Record<string, PendingStops>>;
  begin: (threadKey: string, agentId: string, commandId: string) => void;
  settle: (threadKey: string, agentId: string) => void;
}

const useSubagentStopStore = create<SubagentStopState>()((set) => ({
  pendingByThreadKey: {},
  begin: (threadKey, agentId, commandId) =>
    set((state) => ({
      pendingByThreadKey: {
        ...state.pendingByThreadKey,
        [threadKey]: { ...state.pendingByThreadKey[threadKey], [agentId]: commandId },
      },
    })),
  settle: (threadKey, agentId) =>
    set((state) => {
      const pending = state.pendingByThreadKey[threadKey];
      if (!pending || !(agentId in pending)) return state;
      const { [agentId]: _settled, ...rest } = pending;
      return { pendingByThreadKey: { ...state.pendingByThreadKey, [threadKey]: rest } };
    }),
}));

const NO_PENDING_STOPS: PendingStops = {};

function toastStopFailure(description: string) {
  toastManager.add({ type: "error", title: "Couldn't stop the subagent", description });
}

export interface SubagentStopControl {
  /** True while a stop for this subagent waits on the provider. */
  readonly isPending: (agentId: string) => boolean;
  readonly stop: (agentId: string) => void;
}

export function useSubagentStop(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly threadKey: string | null;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly model: AgentPanelModel;
}): SubagentStopControl {
  const { environmentId, threadId, threadKey, activities, model } = input;
  const pending = useSubagentStopStore((state) =>
    threadKey ? (state.pendingByThreadKey[threadKey] ?? NO_PENDING_STOPS) : NO_PENDING_STOPS,
  );
  const stopSubagent = useAtomCommand(threadEnvironment.stopSubagent, { reportFailure: false });

  // A stop settles when its subagent leaves the live states (the provider
  // confirmed it, or it finished first) or when the server records a failure.
  useEffect(() => {
    if (!threadKey) return;
    const { settle } = useSubagentStopStore.getState();
    for (const [agentId, commandId] of Object.entries(pending)) {
      const failure = findSubagentStopFailure(activities, commandId);
      if (failure !== null) {
        toastStopFailure(failure);
        settle(threadKey, agentId);
        continue;
      }
      const agent = findSubagent(model, agentId);
      if (!agent || !isActiveSubagentStatus(agent.status)) settle(threadKey, agentId);
    }
  }, [activities, model, pending, threadKey]);

  const stop = useCallback(
    (agentId: string) => {
      if (!environmentId || !threadId || !threadKey) return;
      const { begin, settle, pendingByThreadKey } = useSubagentStopStore.getState();
      if (pendingByThreadKey[threadKey]?.[agentId] !== undefined) return;
      const commandId = CommandId.make(randomUUID());
      begin(threadKey, agentId, commandId);
      void stopSubagent({
        environmentId,
        input: { threadId, subagentId: agentId, commandId },
      }).then((result) => {
        if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
        settle(threadKey, agentId);
        const error = squashAtomCommandFailure(result);
        toastStopFailure(error instanceof Error ? error.message : "The server rejected the stop.");
      });
    },
    [environmentId, stopSubagent, threadId, threadKey],
  );

  return useMemo(
    () => ({ isPending: (agentId: string) => pending[agentId] !== undefined, stop }),
    [pending, stop],
  );
}
