/**
 * One filled button per screen, and the fill follows the keyboard. Every right panel control that
 * can be filled asks this who holds the fill and renders outline unless it is the answer.
 *
 * - The composer holds text: Send, beside the panel, holds it and nothing in the panel is filled.
 * - A comment draft is open: the keyboard is in the draft, whose button is never filled (its key
 *   attaches the comment), so nothing else is filled either.
 * - Diff: the review footer's step (Next change, Reply with N comments, Commit, Settle thread).
 *   The rail's commit button is never filled.
 * - Pull request Code tab: the review footer's step; once the review has no step left, the merge
 *   button when the pull request is ready.
 * - Pull request Summary: the next step card's primary action, or the merge button when ready.
 * - Pull request Timeline: the merge button when ready.
 * - Any other surface (Files, Terminal, Browser, Device, Run details): its own single action.
 *
 * Review verdicts (Approve, Request changes) and review thread replies are never filled.
 */
export type PanelFillHolder = "send" | "review-step" | "next-step" | "merge" | "surface-action";

export type PanelFillView =
  | { readonly kind: "diff" }
  | {
      readonly kind: "pull-request";
      readonly tab: "summary" | "timeline" | "code";
      /** The next step card offers a primary action. */
      readonly nextStepHasAction: boolean;
      /** Everything is met: the next step is "Ready to merge". */
      readonly mergeReady: boolean;
    }
  | { readonly kind: "surface" };

export interface PanelFillState {
  readonly view: PanelFillView;
  readonly composerHasText: boolean;
  readonly commentDraftOpen: boolean;
  /** The review footer under a diff offers a step. */
  readonly reviewStepPending: boolean;
}

export function panelFillHolder(state: PanelFillState): PanelFillHolder | null {
  if (state.composerHasText) return "send";
  if (state.commentDraftOpen) return null;
  const { view } = state;
  switch (view.kind) {
    case "diff":
      return state.reviewStepPending ? "review-step" : null;
    case "surface":
      return "surface-action";
    case "pull-request":
      switch (view.tab) {
        case "code":
          if (state.reviewStepPending) return "review-step";
          return view.mergeReady ? "merge" : null;
        case "summary":
          if (view.nextStepHasAction) return "next-step";
          return view.mergeReady ? "merge" : null;
        case "timeline":
          return view.mergeReady ? "merge" : null;
      }
  }
}
