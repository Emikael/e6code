import {
  describeMotionResolution,
  MOTION_PREFERENCE_OPTIONS,
  type MotionLevel,
  type MotionPreference,
} from "@e6tools/client-runtime/motion-level";

import type { MotionPolicyState } from "~/next/motion/policy";

/**
 * The explanation line under the control. Its words and its icon both come from one policy
 * snapshot, so they always name the level in use.
 */
export function motionResolutionLine(
  state: Pick<MotionPolicyState, "preference" | "level" | "reasons">,
): { readonly text: string; readonly level: MotionLevel } | null {
  const text = describeMotionResolution(state.preference, state.reasons);
  return text === null ? null : { text, level: state.level };
}

/**
 * Home and End for the segmented control: Base UI's radio group leaves them off, and the
 * design asks for them to jump to the first and last level.
 */
export function motionPreferenceForKey(key: string): MotionPreference | null {
  if (key === "Home") return MOTION_PREFERENCE_OPTIONS[0]!.value;
  if (key === "End") return MOTION_PREFERENCE_OPTIONS.at(-1)!.value;
  return null;
}

/**
 * The group's keydown handler for Home and End: moves focus to the target radio and selects
 * it (selection follows focus, as with the arrows). Returns whether the key was handled, so
 * the caller can stop the browser from scrolling the page.
 */
export function handleMotionHomeEnd(
  key: string,
  current: MotionPreference,
  actions: {
    readonly focus: (preference: MotionPreference) => void;
    readonly select: (preference: MotionPreference) => void;
  },
): boolean {
  const target = motionPreferenceForKey(key);
  if (target === null) return false;
  actions.focus(target);
  if (target !== current) actions.select(target);
  return true;
}
