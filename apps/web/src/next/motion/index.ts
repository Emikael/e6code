/**
 * The v2 motion layer: the only module that may import an animation engine (enforced by
 * `e6code/no-animation-library-imports`). Feature code animates through what this exports.
 *
 * Rules every caller keeps: transform and opacity only; nothing repaints at idle; every
 * animation has a Reduced form that still shows the change; values come from the tokens.
 * Connection mode is not a policy input: animate optimistically from local state and never
 * wait on a round trip.
 *
 * First consumers: the presets (E02-T03), the Motion setting (E02-T06), the ambient canvas
 * (E02-T10) and the v2 shell, which mounts `MotionConfig` with `motionConfigFor` (E04-T14).
 */
export type { MotionLevel, MotionPreference } from "@e6tools/client-runtime/motion-level";
export { motionPolicy, useMotionPolicy, type MotionPolicyStore } from "./policy.ts";
export { allowsViewTransitions, motionConfigFor, type MotionConfigProps } from "./motionConfig.ts";
export { DISTANCE, DUR, DUR_S, EASE, EASE_BEZIER, SET_PIECE_MS, STAGGER } from "./tokens.ts";
export {
  runTimeline,
  type CinematicEngine,
  type CinematicOutcome,
  type CinematicSequence,
  type CinematicTimeline,
} from "./cinematic/runTimeline.ts";
