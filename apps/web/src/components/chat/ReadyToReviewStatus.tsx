import { ListChecksIcon } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * "Ready to review": a finished turn named as its next step. Boards 2 and 3
 * draw it in the muted status colour with the list-checks glyph, not a success
 * tick. The now bar and the focus bar both render this, so the two cannot drift.
 */
export function ReadyToReviewStatus({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs leading-4 font-medium text-muted-foreground",
        className,
      )}
    >
      <ListChecksIcon aria-hidden className="size-3.5 shrink-0" />
      Ready to review
    </span>
  );
}
