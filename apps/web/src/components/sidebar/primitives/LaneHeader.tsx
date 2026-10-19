import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { BranchLabel } from "./BranchLabel";
import { CountBadge } from "./CountBadge";

export function LaneHeader({
  branch,
  count,
  expanded,
  onToggle,
  worktree = false,
  metadata,
  actions,
  controlsId,
  className,
}: {
  branch: string | null;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  worktree?: boolean;
  metadata?: ReactNode;
  actions?: ReactNode;
  controlsId?: string;
  className?: string;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-(length:--sb-text-meta) text-sb-muted",
        className,
      )}
    >
      <Button
        variant="chip"
        className="sb-action min-w-0 flex-1 justify-start gap-1"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={onToggle}
        aria-label={`${branch ?? "No branch"}, ${count} threads`}
      >
        <Chevron aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.75} />
        <BranchLabel branch={branch} worktree={worktree} />
        <CountBadge count={count} label="threads" />
      </Button>
      {metadata && <span className="flex shrink-0 items-center gap-1 font-mono">{metadata}</span>}
      {actions}
    </div>
  );
}
