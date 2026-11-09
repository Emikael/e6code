/**
 * The merge an open pull request panel can start right now, published so the command palette
 * can offer it under the same `pullRequest.merge` shortcut the panel answers. Only a panel whose
 * merge button is live sets it, and the action opens the panel's own confirmation rather than
 * merging outright.
 */
import { create } from "zustand";

export interface PullRequestMergeCommand {
  /** Which panel published it, so an unmounting panel only clears its own. */
  readonly owner: string;
  readonly number: number;
  readonly title: string;
  readonly run: () => void;
}

interface PullRequestMergeCommandState {
  readonly command: PullRequestMergeCommand | null;
  readonly publish: (command: PullRequestMergeCommand) => void;
  readonly withdraw: (owner: string) => void;
}

export const usePullRequestMergeCommandStore = create<PullRequestMergeCommandState>((set) => ({
  command: null,
  publish: (command) => set({ command }),
  withdraw: (owner) => set((state) => (state.command?.owner === owner ? { command: null } : state)),
}));
