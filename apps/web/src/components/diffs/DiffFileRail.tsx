import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo, useState, type ReactNode } from "react";

import type { DiffReviewStatus } from "~/diffReviewStore";
import { cn } from "~/lib/utils";

import { DiffStat } from "../DiffStat";
import { Skeleton } from "../ui/skeleton";
import {
  fileCountLabel,
  generatedFoldLabel,
  visibleRailRows,
  type DiffRailRow,
} from "./diffFileRail.logic";
import { DiffReviewTick } from "./DiffReviewTick";

/** The rail's width at every scope, so switching scope never moves the diff beside it. */
export const DIFF_FILE_RAIL_CLASS_NAME =
  "flex w-[min(244px,45%)] min-w-0 shrink-0 flex-col border-r border-border bg-sidebar";

/** The rail's heading row: the file count and any count beside it. View › File list hides it. */
export function DiffFileRailHeader(props: {
  readonly fileCount: number | null;
  readonly meta?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 pt-2.5 pb-1.5">
      <span className="min-w-0 flex-1 truncate font-medium text-[13px]">
        {props.fileCount === null ? "Files" : fileCountLabel(props.fileCount)}
      </span>
      {props.meta ? (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {props.meta}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The Diff tab's list of changed files, in the order the diff body shows them. Selecting a row
 * scrolls the body to that file; the current row carries the selected edge. Generated files fold
 * into one row.
 */
export function DiffFileRail(props: {
  readonly rows: readonly DiffRailRow[] | null;
  /** Each file's review mark, when review marks are kept here. */
  readonly reviewStatusOf: ((path: string) => DiffReviewStatus) | null;
  readonly reviewedCount: number;
  readonly currentPath: string | null;
  readonly onSelect: (path: string) => void;
  /** Said under the current row's name, as "change 1 of 2". */
  readonly currentCaption?: string | null;
  /** Below the rows, at the rail's foot. */
  readonly footer?: ReactNode;
}) {
  const [showGenerated, setShowGenerated] = useState(false);
  const view = props.rows ? visibleRailRows(props.rows, showGenerated) : null;
  return (
    <nav aria-label="Changed files" className={DIFF_FILE_RAIL_CLASS_NAME}>
      <DiffFileRailHeader
        fileCount={props.rows?.length ?? null}
        meta={props.rows && props.reviewStatusOf ? `${props.reviewedCount} reviewed` : null}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2.5">
        {view === null ? (
          // The rows' space is held while the diff loads, so nothing jumps when it arrives.
          Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex h-8 items-center gap-2 px-2">
              <Skeleton className="h-3 flex-1 rounded-full" />
              <Skeleton className="h-3 w-8 rounded-full" />
            </div>
          ))
        ) : view.rows.length === 0 && view.generatedCount === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">No changed files.</p>
        ) : (
          <>
            {view.rows.map((row) => (
              <DiffFileRailRow
                key={row.path}
                row={row}
                status={props.reviewStatusOf?.(row.path) ?? null}
                current={row.path === props.currentPath}
                currentCaption={row.path === props.currentPath ? props.currentCaption : null}
                onSelect={props.onSelect}
              />
            ))}
            {view.generatedCount > 0 ? (
              <button
                type="button"
                aria-expanded={showGenerated}
                onClick={() => setShowGenerated((current) => !current)}
                className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-muted-foreground text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                {showGenerated ? (
                  <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {generatedFoldLabel(view.generatedCount, showGenerated)}
                </span>
              </button>
            ) : null}
          </>
        )}
      </div>
      {props.footer}
    </nav>
  );
}

const DiffFileRailRow = memo(function DiffFileRailRow(props: {
  readonly row: DiffRailRow;
  readonly status: DiffReviewStatus | null;
  readonly current: boolean;
  readonly currentCaption?: string | null | undefined;
  readonly onSelect: (path: string) => void;
}) {
  const { row, status } = props;
  const caption = [
    row.folder,
    status === "changed" ? "changed since review" : null,
    props.currentCaption ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      aria-current={props.current ? "true" : undefined}
      onClick={() => props.onSelect(row.path)}
      className={cn(
        "flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        caption ? "min-h-[46px]" : "min-h-8",
        props.current
          ? "bg-sidebar-row-selected ring-1 ring-inset ring-primary-edge"
          : "hover:bg-accent",
      )}
    >
      {status ? <DiffReviewTick status={status} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate font-mono text-xs",
            status === "reviewed" && "text-muted-foreground",
          )}
        >
          {row.name}
        </span>
        {caption ? <span className="truncate text-muted-foreground text-xs">{caption}</span> : null}
      </span>
      <DiffStat
        tone="neutral"
        additions={row.additions}
        deletions={row.deletions}
        className="shrink-0 text-[11px] text-muted-foreground"
      />
    </button>
  );
});
