import { useLayoutEffect, useRef } from "react";

import {
  canAnimate,
  EASE_OUT,
  playTransient,
  prefersReducedMotion,
  SPRING_GENTLE,
  staggerDelay,
} from "~/lib/motion";
import { cn } from "~/lib/utils";
import { E6Wordmark } from "./E6Wordmark";

/** The brand's two-band motif: cyan then orange, hard-stopped. */
export function BrandStripe({ className }: { className?: string }) {
  return (
    <span aria-hidden data-slot="brand-stripe" className={cn("flex", className)}>
      <span className="flex-1 origin-left bg-(--brand-cyan)" />
      <span className="flex-1 origin-left bg-(--brand-orange)" />
    </span>
  );
}

// The assembly greets the first empty surface of a session; repeats are noise.
let assembledThisSession = false;

function playMonogramAssembly(tile: HTMLElement) {
  const mark = tile.querySelector("svg");
  const stripe = tile.querySelector("[data-slot=brand-stripe]");
  if (!canAnimate(mark) || !stripe) return null;
  const motions = [
    playTransient(tile, {
      opacity: [0, 1],
      transform: ["scale(0.86)", "none"],
      ease: SPRING_GENTLE,
    }),
    playTransient(mark, {
      opacity: [0, 1],
      transform: ["translateY(35%)", "none"],
      duration: 420,
      delay: 90,
      ease: EASE_OUT,
    }),
    playTransient(Array.from(stripe.children).filter(canAnimate), {
      transform: ["scaleX(0)", "scaleX(1)"],
      duration: 360,
      delay: staggerDelay(110, 220),
      ease: EASE_OUT,
    }),
  ];
  // Marked on completion, not start: StrictMode's mount replay cancels the first run.
  void Promise.all(motions.map((motion) => motion.finished)).then(() => {
    assembledThisSession = true;
  });
  return () => {
    for (const motion of motions) motion.cancel();
  };
}

/** The E6 tile: off-white mark on charcoal with a cyan/orange edge. Size it
    with `size-*`; the mark and edge scale with the tile. `assemble` builds the
    tile once per session on empty surfaces. */
export function E6Monogram({
  className,
  assemble = false,
}: {
  className?: string;
  assemble?: boolean;
}) {
  const tileRef = useRef<HTMLSpanElement>(null);

  // Layout effect: the WAAPI start must land before the first paint of the tile.
  useLayoutEffect(() => {
    const tile = tileRef.current;
    if (!assemble || assembledThisSession || !canAnimate(tile) || prefersReducedMotion()) return;
    return playMonogramAssembly(tile) ?? undefined;
  }, [assemble]);

  return (
    <span
      ref={tileRef}
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[27%] bg-(--brand-charcoal) text-(--brand-off-white) shadow-[0_1px_2px_rgb(0_0_0/0.25)] ring-1 ring-white/10 ring-inset",
        className,
      )}
    >
      <E6Wordmark className="h-[36%] w-auto -translate-y-[7%]" />
      <BrandStripe className="absolute inset-x-0 bottom-0 h-[15%]" />
    </span>
  );
}
