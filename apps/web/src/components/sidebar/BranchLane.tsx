import { useDroppable } from "@dnd-kit/core";
import { Pin } from "lucide-react";
import { createContext, useId, type ReactNode, type Ref } from "react";
import { cn } from "~/lib/utils";
import {
  SIDEBAR_STATUS_SECTION_LABELS,
  sidebarBranchLaneId,
  sidebarMarkerId,
  type LanePullRequestSummary,
  type SidebarStatusSectionKey,
} from "../Sidebar.logic";
import { LaneHeader, threadCountLabel } from "./primitives/LaneHeader";

/** The id of the lane's rows, for a custom header's toggle `aria-controls`. */
export const BranchLaneRowsIdContext = createContext<string | undefined>(undefined);

export interface BranchLaneProps {
  laneKey: string;
  branch: string | null;
  worktree?: boolean;
  count: number;
  projectName?: string;
  pinned?: boolean;
  /** A Status-mode section: a heading, never collapsed. */
  status?: SidebarStatusSectionKey;
  rejected?: boolean;
  dragOver?: boolean;
  /** Collapse state; without `onToggle` the lane cannot collapse. */
  expanded?: boolean;
  onToggle?: () => void;
  containsOpenThread?: boolean;
  live?: boolean;
  pullRequest?: LanePullRequestSummary | null;
  cleanUp?: boolean;
  density?: "comfortable" | "compact";
  /** Replaces the lane header, e.g. a Project-mode group header. */
  header?: ReactNode;
  /** Groups that take no drops (Project mode) skip the droppable. */
  droppable?: boolean;
  /** Receives the row list, e.g. to animate rows within the lane. */
  listRef?: Ref<HTMLUListElement>;
  children?: ReactNode;
  /** Rows a collapsed lane still shows (a Project group's open thread). They
      sit outside the region the toggle hides, which stays empty. */
  collapsedRows?: ReactNode;
}

/** A lane is a group inside the thread listbox; its list item is only layout. */
export function BranchLane({
  laneKey,
  branch,
  worktree = false,
  count,
  projectName,
  pinned = false,
  status,
  rejected = false,
  dragOver = false,
  expanded = true,
  onToggle,
  containsOpenThread = false,
  live = false,
  pullRequest = null,
  cleanUp = false,
  density = "comfortable",
  header,
  droppable = true,
  listRef,
  children,
  collapsedRows,
}: BranchLaneProps) {
  const rowsId = useId();
  const { setNodeRef } = useDroppable({
    id: pinned ? sidebarMarkerId("pinned-header") : sidebarBranchLaneId(laneKey),
    disabled: !droppable,
  });
  // An empty Pinned lane only exists during a drag. It stays one compact row
  // because mounting it shifts every lane below the pointer.
  if (pinned && count === 0) {
    return (
      <li role="none" className="list-none">
        <div
          ref={setNodeRef}
          role="group"
          aria-label="Drop to pin"
          data-sb-branch-lane={laneKey}
          data-thread-selection-safe
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
  const name = status
    ? SIDEBAR_STATUS_SECTION_LABELS[status]
    : pinned
      ? "Pinned"
      : (branch ?? "No branch");
  // A collapsed lane takes drops on its header without opening: the rows it
  // would place against are hidden, so it highlights like a shelf drop.
  const collapsedDrop = !expanded && dragOver && !rejected;
  const laneRows = (rows: ReactNode) => (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0 bottom-3 left-[9px] w-px bg-(--sb-lane-line)",
          dragOver && !rejected && "bg-sb-accent",
        )}
      />
      <ul
        ref={listRef}
        role="presentation"
        className={cn(
          "relative flex min-w-0 flex-col",
          density === "compact" ? "gap-0" : "gap-0.5",
        )}
      >
        {rows}
      </ul>
    </>
  );
  return (
    <li role="none" className="mt-1.5 min-w-0 list-none first:mt-0">
      <div
        ref={setNodeRef}
        role="group"
        aria-label={`${name}, ${count} ${threadCountLabel(count)}`}
        data-sb-branch-lane={laneKey}
        data-sb-status-section={status}
        data-sb-collapsed={!expanded || undefined}
        data-sb-drop-rejected={rejected || undefined}
        data-thread-selection-safe
        className={cn(
          "min-w-0 rounded-lg",
          dragOver && !rejected && expanded && "bg-sb-hover",
          collapsedDrop && "bg-sb-selection shadow-[inset_0_0_0_1px_var(--sb-accent)]",
          rejected &&
            "cursor-not-allowed outline outline-(--state-error) -outline-offset-1 **:cursor-not-allowed",
        )}
      >
        <BranchLaneRowsIdContext.Provider value={rowsId}>
          {header ?? (
            <LaneHeader
              branch={branch}
              count={count}
              worktree={worktree}
              projectName={projectName}
              pinned={pinned}
              {...(status ? { status } : {})}
              expanded={expanded}
              {...(onToggle ? { onToggle, controlsId: rowsId } : {})}
              live={live}
              pullRequest={pullRequest}
              cleanUp={cleanUp}
              containsOpenThread={containsOpenThread}
            />
          )}
        </BranchLaneRowsIdContext.Provider>
        <div id={rowsId} hidden={!expanded} className="relative pl-[18px]">
          {expanded && laneRows(children)}
        </div>
        {!expanded && collapsedRows ? (
          <div className="relative pl-[18px]">{laneRows(collapsedRows)}</div>
        ) : null}
      </div>
    </li>
  );
}
