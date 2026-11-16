import type { MotionLevel } from "@e6tools/client-runtime/motion-level";

import { DUR_S } from "./tokens.ts";

/**
 * The props the v2 root passes to `motion`'s `MotionConfig`. The component and the pinned
 * `motion` dependency arrive with the v2 shell (E04-T14), the first place that mounts them.
 *
 * Never `reducedMotion: "user"`: `motion` reads the media query once at mount, and the policy
 * also weighs the setting, power and memory.
 */
export interface MotionConfigProps {
  readonly reducedMotion: "never" | "always";
  readonly transition?: { readonly duration: number };
}

export const motionConfigFor = (level: MotionLevel): MotionConfigProps => {
  switch (level) {
    case "full":
      return { reducedMotion: "never" };
    case "reduced":
      return { reducedMotion: "always", transition: { duration: DUR_S.reduced } };
    case "off":
      return { reducedMotion: "always", transition: { duration: 0 } };
  }
};

/** React and route view transitions run only at Full (ENG-114). */
export const allowsViewTransitions = (level: MotionLevel) => level === "full";
