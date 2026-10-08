import type { MessageId } from "@e6tools/contracts";

import {
  createMomentRegistry,
  MOTION_MS,
  playTransient,
  prefersReducedMotion,
  SPRING_GENTLE,
  type TransientMotion,
} from "~/lib/motion";

// The optimistic row usually mounts within a frame or two of the send.
const flights = createMomentRegistry<MessageId, DOMRectReadOnly>(1_500);
// Travel under this reads as a flicker, not a flight.
const MIN_TRAVEL_PX = 12;

/** Records where a sent message left the composer so its timeline row can arrive from there. */
export function launchMessageFlight(messageId: MessageId, overlay: HTMLElement | null) {
  const surface = overlay?.querySelector('[data-chat-composer-surface="true"]');
  if (surface) flights.mark(messageId, surface.getBoundingClientRect());
}

export function pendingMessageFlight(messageId: MessageId): DOMRectReadOnly | undefined {
  return flights.peek(messageId);
}

export function settleMessageFlight(messageId: MessageId) {
  flights.settle(messageId);
}

/**
 * Lifts the sent bubble from the composer into its slot. Only the vertical
 * travel is carried: the bubble keeps its own width and right alignment, so a
 * transform is enough and the virtualized list never sees a layout change.
 */
export function playMessageArrival(
  bubble: HTMLElement,
  from: DOMRectReadOnly,
): TransientMotion | null {
  const to = bubble.getBoundingClientRect();
  const viewportHeight = bubble.ownerDocument.defaultView?.innerHeight ?? 0;
  const travel = from.top - to.top;
  if (to.bottom < 0 || to.top > viewportHeight || Math.abs(travel) < MIN_TRAVEL_PX) return null;
  if (prefersReducedMotion()) {
    return playTransient(bubble, { opacity: [0, 1], duration: MOTION_MS.instant, ease: "linear" });
  }
  return playTransient(bubble, {
    opacity: [0.35, 1],
    transform: [`translateY(${travel}px) scale(0.97)`, "none"],
    ease: SPRING_GENTLE,
  });
}
