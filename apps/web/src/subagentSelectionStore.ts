/**
 * Which subagent the Inspector shows in detail, per thread. Presentation state
 * only: it is not persisted, and a stale id falls back to the first live
 * subagent in the Inspector.
 */
import { create } from "zustand";

interface SubagentSelectionState {
  readonly selectedByThreadKey: Readonly<Record<string, string>>;
  /** Bumped when a selection should also scroll into view (picked from the thread). */
  readonly revealByThreadKey: Readonly<Record<string, number>>;
  select: (threadKey: string, agentId: string, options?: { readonly reveal?: boolean }) => void;
}

export const useSubagentSelectionStore = create<SubagentSelectionState>()((set) => ({
  selectedByThreadKey: {},
  revealByThreadKey: {},
  select: (threadKey, agentId, options) =>
    set((state) => {
      const reveal = options?.reveal === true;
      if (state.selectedByThreadKey[threadKey] === agentId && !reveal) return state;
      return {
        selectedByThreadKey: { ...state.selectedByThreadKey, [threadKey]: agentId },
        revealByThreadKey: reveal
          ? {
              ...state.revealByThreadKey,
              [threadKey]: (state.revealByThreadKey[threadKey] ?? 0) + 1,
            }
          : state.revealByThreadKey,
      };
    }),
}));
