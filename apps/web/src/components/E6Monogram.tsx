import {
  BRAND_TILE_UNITS,
  brandTileGeometry,
  type BrandTileCut,
} from "@e6tools/design-tokens/brand";
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import {
  canAnimate,
  EASE_OUT,
  playTransient,
  prefersReducedMotion,
  SPRING_GENTLE,
} from "~/lib/motion";
import { cn } from "~/lib/utils";
import { E6Wordmark } from "./E6Wordmark";

const percent = (units: number) => `${(units / BRAND_TILE_UNITS) * 100}%`;

/** Inline geometry per cut, from the one source the boot tile and app icons share. */
function tileLayout(cut: BrandTileCut) {
  const geometry = brandTileGeometry(cut);
  return {
    tile: { borderRadius: `${geometry.radius * 100}%` } satisfies CSSProperties,
    glyph: {
      left: percent(geometry.glyph.x),
      top: percent(geometry.glyph.y),
      width: percent(geometry.glyph.width),
      height: percent(geometry.glyph.height),
    } satisfies CSSProperties,
    band: { height: percent(geometry.band) } satisfies CSSProperties,
  };
}

const LAYOUTS = { default: tileLayout("default"), small: tileLayout("small") } as const;

// The assembly greets the first empty surface of a session; repeats are noise.
let assembledThisSession = false;

function playMonogramAssembly(tile: HTMLElement) {
  const mark = tile.querySelector("svg");
  const band = tile.querySelector("[data-slot=brand-band]");
  if (!canAnimate(mark) || !canAnimate(band)) return null;
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
    playTransient(band, {
      transform: ["scaleX(0)", "scaleX(1)"],
      duration: 360,
      delay: 110,
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

/** The E6 tile: paper glyph on brand ink over one band that follows the
    Accent setting (`--mark-band`). Size it with `size-*`; the glyph and band
    scale with the tile. Use `cut="small"` at 20 px and below. `assemble`
    builds the tile once per session on empty surfaces. */
export function E6Monogram({
  className,
  cut = "default",
  assemble = false,
}: {
  className?: string;
  cut?: BrandTileCut;
  assemble?: boolean;
}) {
  const tileRef = useRef<HTMLSpanElement>(null);
  const layout = LAYOUTS[cut];

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
      style={layout.tile}
      className={cn(
        // The dark-only ring sits above the band so the silhouette stays whole.
        "relative inline-block shrink-0 overflow-hidden bg-(--brand-ink) text-(--brand-paper) after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] dark:after:ring-1 dark:after:ring-edge-strong dark:after:ring-inset",
        className,
      )}
    >
      <span
        data-slot="brand-band"
        style={layout.band}
        className="absolute inset-x-0 bottom-0 origin-left bg-(--mark-band)"
      />
      <E6Wordmark className="absolute" style={layout.glyph} />
    </span>
  );
}
