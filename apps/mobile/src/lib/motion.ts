import { DUR, EASE_BEZIER, SPRING } from "@e6tools/design-tokens/motion";

/**
 * The Key Light motion scale for Reanimated, from the same data the web uses.
 *
 * Springs: `withSpring(value, MOTION_SPRING.snappy)`. Reanimated's duration-based spring takes
 * a damping ratio instead of a bounce; `dampingRatio = 1 - bounce` (inferred, matching how
 * Motion and Anime.js define bounce). Easings: `Easing.bezier(...MOTION_EASE_BEZIER.enter)`.
 */
type SpringName = keyof typeof SPRING;

export const MOTION_SPRING = Object.fromEntries(
  Object.entries(SPRING).map(([name, { bounce, duration }]) => [
    name,
    { duration, dampingRatio: 1 - bounce },
  ]),
) as Record<SpringName, { readonly duration: number; readonly dampingRatio: number }>;

export const MOTION_DURATION_MS = DUR;
export const MOTION_EASE_BEZIER = EASE_BEZIER;
