import { GitBranch } from "lucide-react";
import { cn } from "~/lib/utils";

export function BranchLabel({
  branch,
  worktree = false,
  className,
}: {
  branch: string | null;
  worktree?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 text-(length:--sb-text-meta) text-sb-muted",
        className,
      )}
    >
      <GitBranch aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.75} />
      <span className="truncate font-mono">{branch ?? "No branch"}</span>
      {worktree && (
        <span className="shrink-0 rounded-[5px] bg-sb-hover px-1.5 py-0.5">worktree</span>
      )}
    </span>
  );
}
