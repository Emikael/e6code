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
  /** The step shared by `pop`, `swap`, `iconSwap` and `sideBySide` entrances (ENG-119). */
  brisk: 160,
  /** Exit of a `brisk` entrance, about two thirds of it. */
  briskExit: 110,
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

/**
 * Travel in px and starting scale for entrances. Names containing `scale` are unitless
 * factors; the rest are px. Scale stays within `scaleFrom`..1, with two exceptions decided on
 * ENG-119: `iconScaleFrom` for icons of 20 px or less (`iconSwap`), and the launch tile.
 */
export const DISTANCE = {
  revealMin: 4,
  /** The default `reveal` rise for rows; toasts rise `revealMax`. */
  reveal: 6,
  revealMax: 8,
  dolly: 24,
  /** Amplitude of the rejected-input `shake`. */
  shake: 4,
  scaleFrom: 0.96,
  /** Icons of 20 px or less only. Not a mistake to "fix" back into 0.96..1. */
  iconScaleFrom: 0.6,
  dialogScaleFrom: 0.98,
} as const;

type SpringToken = (typeof SPRING)[keyof typeof SPRING];

/**
 * Position at `t` seconds of a unit spring released from 0 toward 1. `duration` is read as
 * `motion`'s `visualDuration` (stiffness from a period of 1.2 × duration, damping ratio
 * 1 − bounce), so `bounce` 0 is critically damped and never overshoots.
 */
export const springPosition = ({ bounce, duration }: SpringToken, t: number): number => {
  const omega = (2 * Math.PI) / ((duration / 1000) * 1.2);
  const zeta = Math.min(Math.max(1 - bounce, 0.05), 1);
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const envelope = Math.exp(-zeta * omega * t);
  return 1 - envelope * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
};

const SETTLE_TOLERANCE = 0.001;
const CURVE_SAMPLES = 40;

/** Time in ms after which the spring stays within `SETTLE_TOLERANCE` of its target. */
const settleMs = (spring: SpringToken): number => {
  let last = 0;
  for (let ms = 1; ms <= 10_000; ms++) {
    if (Math.abs(1 - springPosition(spring, ms / 1000)) > SETTLE_TOLERANCE) last = ms;
  }
  return last + 1;
};

const round = (value: number) => Number(value.toFixed(4));

/**
 * Springs as CSS `linear()` easings, computed here so no client needs an engine to draw one.
 * The curve lasts `durationMs` (the settling time), emitted as `--spring-<name>` and
 * `--spring-<name>-dur`; a transition must use both together.
 */
// Pure, so a bundle that never reads the curves never computes them.
export const SPRING_CURVE = /* @__PURE__ */ Object.fromEntries(
  Object.entries(SPRING).map(([name, spring]) => {
    const durationMs = settleMs(spring);
    const points = Array.from({ length: CURVE_SAMPLES + 1 }, (_, index) =>
      index === CURVE_SAMPLES
        ? 1
        : round(springPosition(spring, ((index / CURVE_SAMPLES) * durationMs) / 1000)),
    );
    return [name, { linear: `linear(${points.join(", ")})`, durationMs }];
  }),
) as {
  readonly [Name in keyof typeof SPRING]: { readonly linear: string; readonly durationMs: number };
};

/**
 * The `skeleton` loading breath: one stepped dip, then still. Provisional values; E02-T11
 * tunes them against live loading.
 */
export const SKELETON = { durationMs: 840, steps: 6, floorOpacity: 0.6 } as const;
