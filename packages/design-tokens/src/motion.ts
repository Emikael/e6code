/**
 * Motion values as plain data. Clients turn them into animations: web through Anime.js in
 * `apps/web/src/lib/motion.ts`, mobile through Reanimated in `apps/mobile/src/lib/motion.ts`.
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
  /** A short drop into place: menus, toasts, dropped items. */
  drop: { bounce: 0.08, duration: 200 },
} as const;

/*
 * The Key Light motion scale (ENG-141). Legacy callers keep `MOTION_MS`, `EASE_OUT` and
 * `EASE_IN_OUT` until they are rewritten; the two scales differ on purpose.
 */

/**
 * Tween durations in ms, also emitted as `--dur-*`. No single tween runs longer than
 * `scene` + 180; exits take about two thirds of their entrance.
 */
export const DUR = {
  instant: 0,
  micro: 90,
  quick: 140,
  state: 200,
  move: 280,
  scene: 420,
  /**
   * The Reduced motion level's forms (ENG-114): opacity-only fades, no travel or scale.
   * `reduced` is the ceiling; `reducedQuick` is for small state changes.
   */
  reduced: 150,
  reducedQuick: 120,
} as const;

/** A set piece is a sequence of tweens; its whole length, in ms. */
export const SET_PIECE_MS = { min: 600, max: 900 } as const;

/** Cubic Bézier control points, so every client builds its own curve from one source. */
export const EASE_BEZIER = {
  enter: [0.22, 1, 0.36, 1],
  expo: [0.16, 1, 0.3, 1],
  shift: [0.65, 0, 0.35, 1],
  exit: [0.55, 0.055, 0.675, 0.19],
} as const satisfies Record<string, readonly [number, number, number, number]>;

const cubicBezier = ([x1, y1, x2, y2]: readonly number[]) =>
  `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;

/** CSS easings, also emitted as `--ease-enter|expo|shift|exit`. */
export const EASE = {
  enter: cubicBezier(EASE_BEZIER.enter),
  expo: cubicBezier(EASE_BEZIER.expo),
  shift: cubicBezier(EASE_BEZIER.shift),
  exit: cubicBezier(EASE_BEZIER.exit),
  linear: "linear",
} as const;

/** Sibling delay in ms, capped at `max` items. */
export const STAGGER = { step: 24, launchStep: 40, max: 8 } as const;

/** Travel in px and starting scale for entrances. */
export const DISTANCE = { revealMin: 4, revealMax: 8, dolly: 24, scaleFrom: 0.96 } as const;
