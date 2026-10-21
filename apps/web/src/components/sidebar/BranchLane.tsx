import { useDroppable } from "@dnd-kit/core";
import { Pin } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { cn } from "~/lib/utils";
import { sidebarBranchLaneId, sidebarMarkerId } from "../Sidebar.logic";
import { LaneHeader } from "./primitives/LaneHeader";

export interface BranchLaneProps {
  laneKey: string;
  branch: string | null;
  worktree?: boolean;
  count: number;
  projectName?: string;
  pinned?: boolean;
  rejected?: boolean;
  dragOver?: boolean;
  /** Receives the row list, e.g. to animate rows within the lane. */
  listRef?: Ref<HTMLUListElement>;
  children?: ReactNode;
}

export function BranchLane({
  laneKey,
  branch,
  worktree = false,
  count,
  projectName,
  pinned = false,
  rejected = false,
  dragOver = false,
  listRef,
  children,
}: BranchLaneProps) {
  const { setNodeRef } = useDroppable({
    id: pinned ? sidebarMarkerId("pinned-header") : sidebarBranchLaneId(laneKey),
  });
  const label = `${pinned ? "Pinned" : (branch ?? "No branch")}, ${count} threads`;
  // An empty Pinned lane only exists during a drag. It stays one compact row
  // because mounting it shifts every lane below the pointer.
  if (pinned && count === 0) {
    return (
      <li
        ref={setNodeRef}
        role="group"
        aria-label={label}
        data-sb-branch-lane={laneKey}
        data-thread-selection-safe
        className="list-none"
      >
        <div
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-sb-border px-2 text-(length:--sb-text-meta) text-sb-muted",
            dragOver && "border-sb-accent bg-sb-hover text-sb-foreground",
          )}
        >
          <Pin aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.75} />
          Drop to pin
        </div>
      </li>
    );
  }
  return (
    <li
      ref={setNodeRef}
      role="group"
      aria-label={label}
      data-sb-branch-lane={laneKey}
      data-sb-drop-rejected={rejected || undefined}
      data-thread-selection-safe
      className={cn(
        "mt-1.5 min-w-0 list-none rounded-lg first:mt-0",
        dragOver && !rejected && "bg-sb-hover",
        rejected &&
          "cursor-not-allowed outline outline-(--state-error) -outline-offset-1 **:cursor-not-allowed",
      )}
    >
      <LaneHeader
        branch={branch}
        count={count}
        worktree={worktree}
        projectName={projectName}
        pinned={pinned}
      />
      <div className="relative pl-[18px]">
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-0 bottom-3 left-[9px] w-px bg-(--sb-lane-line)",
            dragOver && !rejected && "bg-sb-accent",
          )}
        />
        <ul ref={listRef} role="presentation" className="relative flex min-w-0 flex-col gap-0.5">
          {children}
        </ul>
      </div>
    </li>
  );
}
