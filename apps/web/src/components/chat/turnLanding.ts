import type { TurnId } from "@e6tools/contracts";

import {
  canAnimate,
  createMomentRegistry,
  EASE_OUT,
  MOTION_MS,
  playTransient,
  prefersReducedMotion,
  staggerDelay,
} from "~/lib/motion";

import type { TimelineLatestTurn } from "./MessagesTimeline.logic";

/**
 * Turns that completed while this client watched them run. The timeline's
 * turn-fold row plays the landing moment only for these, so history loads,
 * thread switches, and virtualized remounts stay still.
 */
const landings = createMomentRegistry<TurnId, true>(2_000);

export function isLiveTurnLanding(
  previous: TimelineLatestTurn | null,
  next: TimelineLatestTurn | null,
): boolean {
  return (
    previous !== null &&
    next !== null &&
    previous.turnId === next.turnId &&
    previous.state === "running" &&
    next.state === "completed"
  );
}

export function markTurnLanded(turnId: TurnId, now = Date.now()) {
  landings.mark(turnId, true, now);
}

export function isTurnLandingPending(turnId: TurnId, now = Date.now()): boolean {
  return landings.peek(turnId, now) === true;
}

export function settleTurnLanding(turnId: TurnId) {
  landings.settle(turnId);
}

export type TurnLandingMotion =
  | { readonly kind: "settle" }
  | {
      readonly kind: "play";
      readonly stripe: {
        readonly opacity: readonly [number, number, number, number];
        readonly duration: number;
      };
      readonly label: {
        readonly opacity: readonly [number, number];
        readonly transform: readonly [string, string];
        readonly duration: number;
      };
      readonly bars: { readonly duration: number; readonly staggerMs: number };
    };

/** Reduced motion skips the decorative stripe and settles at once. The label moves with opacity and translate only. */
export function turnLandingMotion(reducedMotion: boolean): TurnLandingMotion {
  if (reducedMotion) return { kind: "settle" };
  return {
    kind: "play",
    stripe: { opacity: [1, 1, 1, 0], duration: 1_600 },
    label: {
      opacity: [0.4, 1],
      transform: ["translateY(3px)", "none"],
      duration: MOTION_MS.layout,
    },
    bars: { duration: 420, staggerMs: 120 },
  };
}

/**
 * The landing moment: the brand stripe draws along the fold row's rule, cyan
 * then orange, holds, and fades back into the plain border while the summary
 * label settles into focus. Returns a cleanup that cancels mid-flight.
 */
export function playTurnLanding(
  stripe: HTMLElement,
  label: HTMLElement,
  onPlayed: () => void,
): () => void {
  const motion = turnLandingMotion(prefersReducedMotion());
  if (motion.kind === "settle") {
    onPlayed();
    return () => {};
  }
  const animations = [
    playTransient(stripe, {
      opacity: [...motion.stripe.opacity],
      duration: motion.stripe.duration,
      ease: "linear",
    }),
    playTransient(label, {
      opacity: [...motion.label.opacity],
      transform: [...motion.label.transform],
      duration: motion.label.duration,
      ease: EASE_OUT,
    }),
    playTransient(Array.from(stripe.children).filter(canAnimate), {
      transform: ["scaleX(0)", "scaleX(1)"],
      duration: motion.bars.duration,
      delay: staggerDelay(motion.bars.staggerMs),
      ease: EASE_OUT,
    }),
  ];
  void Promise.all(animations.map((animation) => animation.finished)).then(onPlayed);
  return () => {
    // `cancel()` reverts and does not resolve `finished`, so an interrupted
    // landing stays pending. A remount inside the moment window retries;
    // after the window the fold stays still.
    for (const animation of animations) animation.cancel();
  };
}
