import { cn } from "~/lib/utils";
import { E6Wordmark } from "./E6Wordmark";

/** Three equal dye bands (cyan, magenta, yellow): the E-6 emulsion motif. */
export function EmulsionStripe({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex", className)}>
      <span className="flex-1 bg-(--emulsion-cyan)" />
      <span className="flex-1 bg-(--emulsion-magenta)" />
      <span className="flex-1 bg-(--emulsion-yellow)" />
    </span>
  );
}

/** The E6 tile: white mark on a dark ground with an emulsion edge. Size it
    with `size-*`; the mark and edge scale with the tile. */
export function E6Monogram({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[27%] bg-(--monogram-ground) text-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] ring-1 ring-white/10 ring-inset",
        className,
      )}
    >
      <E6Wordmark className="h-[36%] w-auto -translate-y-[7%]" />
      <EmulsionStripe className="absolute inset-x-0 bottom-0 h-[15%]" />
    </span>
  );
}
