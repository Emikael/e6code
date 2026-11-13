/**
 * "Ready to review": a finished turn named as its next step, with the muted
 * list-checks glyph boards 2, 3 and Components draw. The now bar and the
 * focus bar both render it, so the two cannot drift. "Done" in lists keeps
 * the success tick.
 */
import { ListChecksIcon } from "lucide-react";

import { cn } from "~/lib/utils";

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
