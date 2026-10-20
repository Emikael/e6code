import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
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
  children: ReactNode;
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
  children,
}: BranchLaneProps) {
  const { setNodeRef } = useDroppable({
    id: pinned ? sidebarMarkerId("pinned-header") : sidebarBranchLaneId(laneKey),
  });
  return (
    <li
      ref={setNodeRef}
      role="group"
      aria-label={`${pinned ? "Pinned" : (branch ?? "No branch")}, ${count} threads`}
      data-sb-branch-lane={laneKey}
      data-sb-drop-rejected={rejected || undefined}
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
        <ul role="presentation" className="flex min-w-0 flex-col gap-0.5">
          {children}
        </ul>
      </div>
    </li>
  );
}
