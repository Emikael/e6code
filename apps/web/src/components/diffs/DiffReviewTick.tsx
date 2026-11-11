import { CheckIcon } from "lucide-react";

import type { DiffReviewStatus } from "~/diffReviewStore";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";

const STATUS_WORDS: Record<DiffReviewStatus, string> = {
  reviewed: "Reviewed",
  changed: "Changed since review",
  unreviewed: "Not reviewed",
};

/**
 * The reviewed box: filled with a tick when reviewed, an empty box otherwise. Neutral, because a
 * review mark is not a status the agent reached. It names itself unless `decorative`, for places
 * where the words sit beside it.
 */
export function DiffReviewTick(props: {
  readonly status: DiffReviewStatus;
  readonly decorative?: boolean;
  readonly className?: string;
}) {
  const reviewed = props.status === "reviewed";
  return (
    <span
      {...(props.decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": STATUS_WORDS[props.status] })}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]",
        reviewed ? "border-foreground bg-foreground text-background" : "border-muted-foreground",
        props.className,
      )}
    >
      {reviewed ? <CheckIcon aria-hidden className="size-3" strokeWidth={2.5} /> : null}
    </span>
  );
}

/**
 * A file header's "Mark reviewed" / "Reviewed" toggle. Advisory: it gates nothing, and pressing it
 * again takes the mark back. The pressed state carries the selected edge, since a wash alone
 * is too faint to see.
 */
export function DiffReviewToggle(props: {
  readonly path: string;
  readonly status: DiffReviewStatus;
  /** The file is expanded: an unreviewed open file offers the toggle as an outline button. */
  readonly open?: boolean;
  readonly onToggle: (path: string, reviewed: boolean) => void;
}) {
  const reviewed = props.status === "reviewed";
  return (
    <Button
      type="button"
      size="compact"
      variant={!reviewed && props.open ? "outline" : "ghost"}
      aria-pressed={reviewed}
      aria-label={`${reviewed ? "Reviewed" : "Mark reviewed"}: ${props.path}`}
      className={cn(
        "shrink-0 gap-1.5 font-sans",
        reviewed && "bg-secondary ring-1 ring-inset ring-primary-edge",
      )}
      onClick={(event) => {
        // The header folds its file on click; the toggle keeps its press to itself.
        event.stopPropagation();
        props.onToggle(props.path, !reviewed);
      }}
    >
      <DiffReviewTick status={props.status} decorative />
      {reviewed ? "Reviewed" : "Mark reviewed"}
    </Button>
  );
}
