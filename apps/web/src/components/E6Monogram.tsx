import { useId, useLayoutEffect, useRef } from "react";

import {
  canAnimate,
  EASE_OUT,
  playTransient,
  prefersReducedMotion,
  SPRING_GENTLE,
  staggerDelay,
} from "~/lib/motion";
import { cn } from "~/lib/utils";
import { E6_GLYPH_PATHS } from "./E6Wordmark";

// The step meter under the glyph: five 8x4 pills, 12 apart, the first three filled.
const METER_STEPS = [36, 48, 60, 72, 84] as const;
const METER_FILLED_STEPS = 3;

// The assembly greets the first empty surface of a session; repeats are noise.
let assembledThisSession = false;

function playMonogramAssembly(tile: SVGSVGElement) {
  const glyph = tile.querySelector("[data-slot=brand-glyph]");
  const steps = Array.from(tile.querySelectorAll("[data-slot=brand-step]")).filter(canAnimate);
  if (!canAnimate(glyph)) return null;
  const motions = [
    playTransient(tile, {
      opacity: [0, 1],
      transform: ["scale(0.86)", "none"],
      ease: SPRING_GENTLE,
    }),
    playTransient(glyph, {
      opacity: [0, 1],
      transform: ["translateY(35%)", "none"],
      duration: 420,
      delay: 90,
      ease: EASE_OUT,
    }),
    playTransient(steps, {
      transform: ["scaleX(0)", "none"],
      duration: 260,
      delay: staggerDelay(90, 260),
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

/** The E6 tile: the app icon's graphite ground, glyph and step meter. Size it
    with `size-*`; everything scales with the tile. `assemble` builds the tile
    once per session on empty surfaces. */
export function E6Monogram({
  className,
  assemble = false,
}: {
  className?: string;
  assemble?: boolean;
}) {
  const tileRef = useRef<SVGSVGElement>(null);
  const groundId = `${useId().replaceAll(":", "")}-e6-ground`;

  // Layout effect: the WAAPI start must land before the first paint of the tile.
  useLayoutEffect(() => {
    const tile = tileRef.current;
    if (!assemble || assembledThisSession || !canAnimate(tile) || prefersReducedMotion()) return;
    return playMonogramAssembly(tile) ?? undefined;
  }, [assemble]);

  return (
    <svg
      ref={tileRef}
      aria-hidden
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 rounded-[22.6%] shadow-[0_1px_2px_rgb(0_0_0/0.25)]", className)}
    >
      <defs>
        <linearGradient
          id={groundId}
          x1="64"
          y1="0"
          x2="64"
          y2="128"
          gradientUnits="userSpaceOnUse"
        >
          <stop className="[stop-color:var(--brand-tile-top)]" />
          <stop offset="1" className="[stop-color:var(--brand-tile-bottom)]" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="29" fill={`url(#${groundId})`} />
      <rect
        x="0.75"
        y="0.75"
        width="126.5"
        height="126.5"
        rx="28.25"
        fill="none"
        className="stroke-white/10"
        strokeWidth="1.5"
      />
      <g data-slot="brand-glyph" className="fill-(--brand-ink) [transform-box:fill-box]">
        {E6_GLYPH_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {METER_STEPS.map((x, index) =>
        index < METER_FILLED_STEPS ? (
          <rect
            key={x}
            data-slot="brand-step"
            x={x}
            y="106"
            width="8"
            height="4"
            rx="2"
            className="origin-left fill-(--brand-meter-on) [transform-box:fill-box]"
          />
        ) : (
          <rect
            key={x}
            x={x}
            y="106"
            width="8"
            height="4"
            rx="2"
            fill="none"
            className="stroke-(--brand-meter-off)"
            strokeWidth="1.2"
          />
        ),
      )}
    </svg>
  );
}
