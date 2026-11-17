import { type RefObject, useLayoutEffect, useRef } from "react";

interface AnimatedSubtree {
  getAnimations(options: { subtree: true }): ReadonlyArray<{ finish(): void }>;
}

/**
 * Data beats animation: ends every animation running in `subtree` at its end state, so new
 * content never waits behind an old transition. Returns how many it finished.
 */
export const finishRunningAnimations = (subtree: AnimatedSubtree): number => {
  const animations = subtree.getAnimations({ subtree: true });
  for (const animation of animations) {
    try {
      animation.finish();
    } catch {
      // An animation with no end (none of ours) cannot finish; leave it to its owner.
    }
  }
  return animations.length;
};

/**
 * Finishes the animations under `ref` whenever `commitKey` changes (new content committed),
 * before the browser paints it.
 */
export const useFinishOnCommit = (ref: RefObject<Element | null>, commitKey: unknown) => {
  const previous = useRef(commitKey);
  useLayoutEffect(() => {
    if (Object.is(previous.current, commitKey)) return;
    previous.current = commitKey;
    if (ref.current) finishRunningAnimations(ref.current);
  }, [ref, commitKey]);
};
