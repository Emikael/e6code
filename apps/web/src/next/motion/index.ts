/**
 * The v2 motion layer: the only module that may import an animation engine (enforced by
 * `e6code/no-animation-library-imports`). Feature code animates through what this exports.
 *
 * Rules every caller keeps: transform and opacity only; nothing repaints at idle; every
 * animation has a Reduced form that still shows the change; values come from the tokens.
 * Connection mode is not a policy input: animate optimistically from local state and never
 * wait on a round trip.
 *
 * First consumers: the Motion setting (E02-T06), the ambient canvas (E02-T10), the v2
 * primitives that adopt the recipes (E01-T14), the style guide's motion gallery (E01-T16) and
 * the v2 shell, which mounts `MotionRoot` (E04-T14).
 */
export type { MotionLevel, MotionPreference } from "@e6tools/client-runtime/motion-level";
export { motionPolicy, useMotionPolicy, type MotionPolicyStore } from "./policy.ts";
export { allowsViewTransitions, motionConfigFor, type MotionConfigProps } from "./motionConfig.ts";
export { DISTANCE, DUR, DUR_S, EASE, EASE_BEZIER, SET_PIECE_MS, STAGGER } from "./tokens.ts";
export { LayoutScope, MotionRoot } from "./MotionRoot.tsx";
export { MOTION_RECIPES, type MotionRecipe } from "./presets/recipes.ts";
export { LayoutBox, NumberRoll, PresenceSwap } from "./presets/Presence.tsx";
export { oneShots } from "./presets/oneShot.ts";
export { MOTION_CATALOGUE, type CatalogueEntry } from "./catalogue.ts";
export { staggerDelayMs } from "./choreography/stagger.ts";
export { depthDirection } from "./choreography/direction.ts";
export { finishRunningAnimations, useFinishOnCommit } from "./choreography/finishOnCommit.ts";
export { useInViewport } from "./choreography/viewport.ts";
export { streamingPriority, useDecorativeMotion } from "./choreography/streamingPriority.ts";
export { COPY_CONFIRM_HOLD_MS, useCopyConfirm } from "./choreography/copyConfirm.ts";
export {
  runTimeline,
  type CinematicEngine,
  type CinematicOutcome,
  type CinematicSequence,
  type CinematicTimeline,
} from "./cinematic/runTimeline.ts";
