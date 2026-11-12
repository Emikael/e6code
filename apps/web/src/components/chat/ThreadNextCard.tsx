/**
 * "Next: review the changes" (board 3, F6): a turn that finished with changes
 * ends in one clear next step. Review diff carries the screen's one fill until
 * you start typing, when Send takes it.
 */
import { CheckIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { formatNextCardChanges, type NextCardState } from "./ThreadNextCard.logic";

export const ThreadNextCard = memo(function ThreadNextCard({
  state,
  reviewShortcut,
  primary,
  onReviewDiff,
  onSettle,
  onAskForChanges,
}: {
  state: NextCardState;
  reviewShortcut: string | null;
  /** False while the composer holds a draft: the fill follows the keyboard. */
  primary: boolean;
  onReviewDiff: () => void;
  /** Absent when the server cannot settle threads. */
  onSettle: (() => void) | null;
  onAskForChanges: () => void;
}) {
  return (
    <section
      aria-label="Next step"
      className="mb-2.5 flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm leading-5 font-semibold text-foreground">
          Next: review the changes
        </h2>
        <span className="shrink-0 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground tabular-nums">
          {formatNextCardChanges(state)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={primary ? "default" : "outline"}
          className="sm:text-[13px]"
          onClick={onReviewDiff}
        >
          Review diff
          {reviewShortcut ? (
            <Kbd
              className={cn(
                "h-[18px] min-w-[18px] bg-transparent px-1 ring-1",
                primary ? "text-primary-foreground ring-primary-foreground" : "ring-border",
              )}
            >
              {reviewShortcut}
            </Kbd>
          ) : null}
        </Button>
        {onSettle ? (
          <Button variant="outline" className="sm:text-[13px]" onClick={onSettle}>
            <CheckIcon aria-hidden />
            Settle thread
          </Button>
        ) : null}
        <Button variant="ghost" className="sm:text-[13px]" onClick={onAskForChanges}>
          Ask for changes
        </Button>
      </div>
    </section>
  );
});
