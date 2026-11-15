/**
 * Motion values as plain data. Clients turn them into animations: web through Anime.js in
 * `apps/web/src/lib/motion.ts`.
 */
export const MOTION_MS = {
  instant: 120,
  state: 200,
  layout: 360,
} as const;

/** Confident deceleration for arrivals. Exits use `EASE_IN_OUT` and run shorter. */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.4, 0, 0.2, 1)";

export const SPRING = {
  /** Small settle for things the user just caused: highlights, cards, chips. */
  snappy: { bounce: 0.12, duration: 260 },
  /** No overshoot, for layout-adjacent motion where a bounce would read as jitter. */
  gentle: { bounce: 0, duration: 380 },
} as const;
