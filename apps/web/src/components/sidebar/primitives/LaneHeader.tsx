import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { BranchLabel } from "./BranchLabel";
import { CountBadge } from "./CountBadge";

export function LaneHeader({
  branch,
  count,
  expanded = true,
  onToggle,
  worktree = false,
  pinned = false,
  projectName,
  metadata,
  actions,
  controlsId,
  className,
}: {
  branch: string | null;
  count: number;
  expanded?: boolean;
  onToggle?: () => void;
  worktree?: boolean;
  pinned?: boolean;
  projectName?: string | undefined;
  metadata?: ReactNode;
  actions?: ReactNode;
  controlsId?: string;
  className?: string;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const label = pinned ? "Pinned" : (branch ?? "No branch");
  const content = (
    <>
      {onToggle && <Chevron aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.75} />}
      {pinned ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-sb-foreground">
          <Pin aria-hidden="true" className="size-3 shrink-0 text-sb-muted" strokeWidth={1.75} />
          Pinned
        </span>
      ) : (
        <>
          {projectName && (
            <span className="max-w-[72px] shrink-[50] truncate">{projectName} /</span>
          )}
          <BranchLabel branch={branch} worktree={worktree} lane={!onToggle} />
        </>
      )}
      <CountBadge count={count} label="threads" />
    </>
  );
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-(length:--sb-text-meta) text-sb-muted",
        !onToggle && "h-7 rounded-md pl-0.5 pr-1",
        className,
      )}
    >
      {onToggle ? (
        <Button
          variant="chip"
          className="sb-action min-w-0 flex-1 justify-start gap-1"
          aria-expanded={expanded}
          aria-controls={controlsId}
          onClick={onToggle}
          aria-label={`${label}, ${count} threads`}
        >
          {content}
        </Button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{content}</div>
      )}
      {metadata && <span className="flex shrink-0 items-center gap-1 font-mono">{metadata}</span>}
      {actions}
    </div>
  );
}
