import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { attachedNotSentLabel } from "~/lib/attachedForAgent";

/**
 * "1 comment not sent" while the thread's composer holds attached items, so they are not
 * forgotten on a thread in the background. Counted the way the composer's attached row lists
 * them. A string, so a row re-renders only when the words change.
 */
export function useAttachedNotSentLabel(target: ComposerThreadTarget | null): string | null {
  return useComposerDraftStore((store) =>
    target === null ? null : attachedNotSentLabel(store.getComposerDraft(target)),
  );
}
