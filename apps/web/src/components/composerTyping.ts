import { useEffect, useState } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";

const COMPOSER_SELECTOR = '[data-chat-composer-main-surface="true"]';

/**
 * Whether the user is writing a message: focus is in the composer and it holds text. Proactive
 * panels wait while this is true, so a tab never opens under someone mid-sentence; they open
 * once the composer loses focus or the message is sent.
 */
export function isComposerTyping(input: {
  readonly focusInComposer: boolean;
  readonly prompt: string | undefined;
}): boolean {
  return input.focusInComposer && composerHoldsText(input.prompt);
}

/** A draft of only spaces and newlines is not a message being written. */
function composerHoldsText(prompt: string | undefined): boolean {
  return prompt !== undefined && prompt.trim().length > 0;
}

function isInComposer(element: EventTarget | null): boolean {
  return element instanceof Element && element.closest(COMPOSER_SELECTOR) !== null;
}

/** `isComposerTyping` for this thread's composer, re-rendering only when the answer changes. */
export function useComposerTyping(target: ComposerThreadTarget | null): boolean {
  const [focusInComposer, setFocusInComposer] = useState(() =>
    typeof document === "undefined" ? false : isInComposer(document.activeElement),
  );
  useEffect(() => {
    // focusin names the element gaining focus; focusout names it as its related target.
    const onFocusIn = (event: FocusEvent) => setFocusInComposer(isInComposer(event.target));
    const onFocusOut = (event: FocusEvent) => setFocusInComposer(isInComposer(event.relatedTarget));
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  // A boolean, so ChatView does not re-render on every keystroke.
  const typing = useComposerDraftStore(
    (store) =>
      target !== null &&
      isComposerTyping({ focusInComposer, prompt: store.getComposerDraft(target)?.prompt }),
  );
  return typing;
}
