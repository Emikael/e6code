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
  const reduced = prefersReducedMotion();
  const animations = [
    playTransient(stripe, {
      opacity: reduced ? [1, 1, 0] : [1, 1, 1, 0],
      duration: reduced ? 900 : 1_600,
      ease: "linear",
    }),
    playTransient(label, {
      opacity: [0.4, 1],
      ...(reduced
        ? {}
        : { filter: ["blur(3px)", "blur(0px)"], transform: ["translateY(3px)", "none"] }),
      duration: reduced ? MOTION_MS.instant : MOTION_MS.layout,
      ease: EASE_OUT,
    }),
  ];
  if (!reduced) {
    animations.push(
      playTransient(Array.from(stripe.children).filter(canAnimate), {
        transform: ["scaleX(0)", "scaleX(1)"],
        duration: 420,
        delay: staggerDelay(120),
        ease: EASE_OUT,
      }),
    );
  }
  void Promise.all(animations.map((motion) => motion.finished)).then(onPlayed);
  return () => {
    for (const motion of animations) motion.cancel();
  };
}
