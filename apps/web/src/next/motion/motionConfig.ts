import type { MotionLevel } from "@e6tools/client-runtime/motion-level";

import { DUR_S } from "./tokens.ts";

/**
 * The props `MotionRoot` passes to `motion`'s `MotionConfig`.
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
      return { reducedMotion: "always", transition: { duration: DUR_S.quick } };
    case "off":
      return { reducedMotion: "always", transition: { duration: 0 } };
  }
};

/** React and route view transitions run only at Full (ENG-114). */
export const allowsViewTransitions = (level: MotionLevel) => level === "full";
