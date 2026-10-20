import { FolderGit2, GitBranch } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export function BranchLabel({
  branch,
  worktree = false,
  lane = false,
  className,
}: {
  branch: string | null;
  worktree?: boolean;
  lane?: boolean;
  className?: string;
}) {
  const Icon = lane && worktree ? FolderGit2 : GitBranch;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 text-(length:--sb-text-meta) text-sb-muted",
        lane && "text-[11.5px] font-medium text-sb-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0 text-sb-muted" strokeWidth={1.75} />
      {lane ? (
        <Tooltip>
          <TooltipTrigger render={<span className="truncate font-mono" />}>
            {branch ?? "No branch"}
          </TooltipTrigger>
          <TooltipPopup>{branch ?? "No branch"}</TooltipPopup>
        </Tooltip>
      ) : (
        <span className="truncate font-mono">{branch ?? "No branch"}</span>
      )}
      {worktree && (
        <span
          className={cn(
            "shrink-0 rounded-[5px] bg-sb-hover px-1.5 py-0.5",
            lane && "text-[10.5px] font-normal text-sb-muted @max-[280px]/sidebar-column:sr-only",
          )}
        >
          worktree
        </span>
      )}
    </span>
  );
}
