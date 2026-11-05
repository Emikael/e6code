/**
 * Which subagent the Inspector shows in detail, per thread. Presentation state
 * only: it is not persisted, and a stale id simply falls back to the first
 * live subagent in the Inspector.
 */
import { create } from "zustand";

interface SubagentSelectionState {
  readonly selectedByThreadKey: Readonly<Record<string, string>>;
  select: (threadKey: string, agentId: string) => void;
}

export const useSubagentSelectionStore = create<SubagentSelectionState>()((set) => ({
  selectedByThreadKey: {},
  select: (threadKey, agentId) =>
    set((state) =>
      state.selectedByThreadKey[threadKey] === agentId
        ? state
        : { selectedByThreadKey: { ...state.selectedByThreadKey, [threadKey]: agentId } },
    ),
}));
