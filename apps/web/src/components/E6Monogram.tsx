import { cn } from "~/lib/utils";
import { E6Wordmark } from "./E6Wordmark";

/** The brand's two-band motif: cyan then orange, hard-stopped. */
export function BrandStripe({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex", className)}>
      <span className="flex-1 bg-(--brand-cyan)" />
      <span className="flex-1 bg-(--brand-orange)" />
    </span>
  );
}

/** The E6 tile: off-white mark on charcoal with a cyan/orange edge. Size it
    with `size-*`; the mark and edge scale with the tile. */
export function E6Monogram({ className }: { className?: string }) {
  return (
    <span
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
