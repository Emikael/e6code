import type { MotionLevel } from "@e6tools/client-runtime/motion-level";

import { STAGGER } from "../tokens.ts";

/**
 * Delay in ms before sibling `index` enters: `STAGGER.step` per item, capped so item 8 and
 * later start together. Lists enter at once below Full and while the focused thread streams
 * (streaming priority), and so does an item outside the viewport.
 */
export const staggerDelayMs = (
  index: number,
  {
    level,
    streaming = false,
    inViewport = true,
  }: { readonly level: MotionLevel; readonly streaming?: boolean; readonly inViewport?: boolean },
): number => {
  if (level !== "full" || streaming || !inViewport) return 0;
  return Math.min(Math.max(index, 0), STAGGER.max - 1) * STAGGER.step;
};
