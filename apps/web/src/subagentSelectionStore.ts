/**
 * Which subagent the Inspector shows in detail, per thread, and which one the
 * thread should scroll to. Presentation state only: it is not persisted, and a
 * stale id falls back to the first live subagent in the Inspector.
 */
import { create } from "zustand";

/** A request from the Overview to bring a subagent's card into view in its thread. */
export interface SubagentThreadTarget {
  readonly threadKey: string;
  readonly agentId: string;
  /** Bumped on every request, so asking for the same subagent twice scrolls again. */
  readonly nonce: number;
}

interface SubagentSelectionState {
  readonly selectedByThreadKey: Readonly<Record<string, string>>;
  /** Bumped when a selection should also scroll into view (picked from the thread). */
  readonly revealByThreadKey: Readonly<Record<string, number>>;
  readonly threadTarget: SubagentThreadTarget | null;
  select: (threadKey: string, agentId: string, options?: { readonly reveal?: boolean }) => void;
  showInThread: (threadKey: string, agentId: string) => void;
}

export const useSubagentSelectionStore = create<SubagentSelectionState>()((set) => ({
  selectedByThreadKey: {},
  revealByThreadKey: {},
  threadTarget: null,
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
  showInThread: (threadKey, agentId) =>
    set((state) => ({
      threadTarget: { threadKey, agentId, nonce: (state.threadTarget?.nonce ?? 0) + 1 },
    })),
}));
