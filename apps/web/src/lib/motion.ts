import { spring } from "animejs/easings/spring";
import { waapi } from "animejs/waapi";
import type { DOMTargetsParam, WAAPIAnimationParams } from "animejs";

/**
 * Shared motion vocabulary for the web client.
 *
 * Routine motion goes through Anime.js `waapi.animate`, which hands keyframes
 * to the Web Animations API so they keep running on the compositor while the
 * main thread is busy streaming a turn. Springs become CSS `linear()` curves,
 * so their length is the spring's settling time, not a fixed duration.
 *
 * Sequence with `delay` rather than `animejs/timeline`: a timeline drives
 * synced WAAPI animations from the JS engine every frame, which reintroduces
 * the main-thread dependency this module exists to avoid.
 */
export const MOTION_MS = {
  instant: 120,
  state: 200,
  layout: 360,
} as const;

/** Confident deceleration for arrivals. Exits use `EASE_IN_OUT` and run shorter. */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.4, 0, 0.2, 1)";

/** Small settle for things the user just caused: highlights, cards, chips. */
export const SPRING_SNAPPY = spring({ bounce: 0.12, duration: 260 });
/** No overshoot, for layout-adjacent motion where a bounce would read as jitter. */
export const SPRING_GENTLE = spring({ bounce: 0, duration: 380 });

/**
 * CSS `linear()` spring curves for transitions CSS already owns. The curve is
 * the spring's shape; the transition's own duration sets its length.
 */
const SPRING_CSS = {
  gentle: waapi.convertEase(SPRING_GENTLE.ease, 40),
  snappy: waapi.convertEase(SPRING_SNAPPY.ease, 40),
} as const;

/** Exposes the spring curves as `--ease-spring-*`, installed once at startup before first render. */
export function installMotionTokens(root: HTMLElement = document.documentElement) {
  root.style.setProperty("--ease-spring-gentle", SPRING_CSS.gentle);
  root.style.setProperty("--ease-spring-snappy", SPRING_CSS.snappy);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Element motion is unavailable in test DOMs and very old engines; callers skip it there. */
export function canAnimate(element: Element | null): element is HTMLElement | SVGElement {
  return (
    (element instanceof HTMLElement || element instanceof SVGElement) &&
    typeof element.animate === "function"
  );
}

export const animate = waapi.animate;

/**
 * Sibling delay for `delay`. Anime's own `stagger` lives in `animejs/utils`,
 * whose barrel loads the JS engine; this keeps the WAAPI path engine-free.
 */
export function staggerDelay(stepMs: number, startMs = 0) {
  return (_target: unknown, index: number) => startMs + index * stepMs;
}

export interface TransientMotion {
  /**
   * Resolves after the motion completes and reverts; never resolves after
   * `cancel()`. Anime also completes an animation that a newer one on the same
   * element and property replaces, so callers own their element's motion.
   */
  readonly finished: Promise<void>;
  cancel(): void;
}

/**
 * Plays motion that ends at the element's natural CSS state, then reverts.
 * Anime commits final values inline when an animation finishes; left there,
 * they would override class-driven states such as hover opacity.
 *
 * Pass `transform` and `opacity` as whole properties. Anime's shorthand
 * transforms (`x`, `scaleX`) animate registered custom properties, which
 * Chromium does not run on the compositor.
 */
export function playTransient(
  targets: DOMTargetsParam,
  params: WAAPIAnimationParams,
): TransientMotion {
  // Completion goes through `onComplete`: a WAAPIAnimation keeps only the
  // latest `then` callback, so a second listener would silently drop the first.
  let resolve: () => void = () => {};
  const finished = new Promise<void>((done) => {
    resolve = done;
  });
  const animation = waapi.animate(targets, {
    ...params,
    onComplete: (self) => {
      self.revert();
      resolve();
    },
  });
  return { finished, cancel: () => animation.revert() };
}

/**
 * One-shot moments keyed by what triggered them (a turn, a sent message).
 * Whoever renders the result peeks while it is fresh and settles after the
 * motion finishes, so StrictMode replays and interrupted plays retry while
 * remounts after the window (virtualized scrolling, thread switches) stay still.
 */
export function createMomentRegistry<K, V>(windowMs: number) {
  const moments = new Map<K, { value: V; at: number }>();
  return {
    mark(key: K, value: V, now = Date.now()) {
      for (const [id, moment] of moments) {
        if (now - moment.at > windowMs) moments.delete(id);
      }
      moments.set(key, { value, at: now });
    },
    peek(key: K, now = Date.now()): V | undefined {
      const moment = moments.get(key);
      return moment && now - moment.at <= windowMs ? moment.value : undefined;
    },
    settle(key: K) {
      moments.delete(key);
    },
  };
}
