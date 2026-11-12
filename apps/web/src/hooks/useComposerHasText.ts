import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { stripInlineContextReferences } from "~/lib/composerContextReferences";

/**
 * Whether the thread's composer holds text of its own (inline context chips do not count). While
 * it does, Send owns the screen's one filled button, so any other primary on screen renders as
 * outline: the fill follows the keyboard.
 */
export function useComposerHasText(target: ComposerThreadTarget | null | undefined): boolean {
  return useComposerDraftStore((store) =>
    target == null
      ? false
      : stripInlineContextReferences(store.getComposerDraft(target)?.prompt ?? "").trim().length >
        0,
  );
}
