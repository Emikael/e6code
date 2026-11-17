import { useSyncExternalStore } from "react";

import { type MotionPolicyStore, motionPolicy } from "../policy.ts";

/**
 * Streaming priority: while the focused thread streams, decorative motion elsewhere stops
 * (stagger, hover scale, the ambient canvas). Informational motion (`sweep` on an approval,
 * a status `swap`) still plays. The v2 chat screen reports the focused thread's state.
 */
export const createStreamingPriority = (policy: Pick<MotionPolicyStore, "getLevel">) => {
  const listeners = new Set<() => void>();
  let streaming = false;

  return {
    setFocusedThreadStreaming(next: boolean) {
      if (next === streaming) return;
      streaming = next;
      for (const listener of listeners) listener();
    },
    isStreaming: () => streaming,
    /** Decorative motion plays only at Full and while nothing streams. */
    allowsDecorativeMotion: () => policy.getLevel() === "full" && !streaming,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
};

export const streamingPriority = /* @__PURE__ */ createStreamingPriority(motionPolicy);

const subscribeBoth = (listener: () => void) => {
  const stopStreaming = streamingPriority.subscribe(listener);
  const stopPolicy = motionPolicy.subscribe(listener);
  return () => {
    stopStreaming();
    stopPolicy();
  };
};

/** Whether decorative motion may play now. */
export const useDecorativeMotion = (): boolean =>
  useSyncExternalStore(subscribeBoth, streamingPriority.allowsDecorativeMotion);
