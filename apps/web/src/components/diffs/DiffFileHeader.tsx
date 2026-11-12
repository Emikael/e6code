import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { DiffReviewStatus } from "~/diffReviewStore";
import { cn } from "~/lib/utils";

import { DiffStat } from "../DiffStat";
import { Button } from "../ui/button";
import { DiffReviewToggle } from "./DiffReviewTick";

/** The height the viewer reserves for every file header, open or folded. */
export const DIFF_FILE_HEADER_HEIGHT = 36;

/**
 * Sizes the viewer's header box to the reserved height. Open and folded headers are both this
 * tall, so a header never hangs over its file's first line and the virtual geometry stays one
 * fixed height.
 */
export const DIFF_FILE_HEADER_CSS = `
[data-diffs-header] {
  height: ${DIFF_FILE_HEADER_HEIGHT}px !important;
  min-height: ${DIFF_FILE_HEADER_HEIGHT}px !important;
  padding: 0 !important;
  overflow: visible !important;
  align-items: stretch !important;
}
[data-diffs-header]:hover {
  box-shadow: none !important;
}`;

/**
 * One file's header in the Diff tab, as board 12 draws it: the fold chevron, the path in mono
 * (muted once reviewed, a link to the editor while the file is open), neutral counts, and the
 * review toggle. Open and folded headers share the reserved 36px; the open one is told apart by
 * its card ground (a folded one sits on the raised ground) and its link-styled path. A file changed since its review offers "Show only what changed" in place of counts.
 * Rendered into the viewer's custom header slot, so it is ordinary React and takes app classes.
 */
export function DiffFileHeader(props: {
  readonly path: string;
  readonly open: boolean;
  /** Its patch has not loaded yet; it cannot be unfolded until it does. */
  readonly pending: boolean;
  /** Null when the tab keeps no review marks here. */
  readonly reviewStatus: DiffReviewStatus | null;
  readonly counts: { readonly additions: number; readonly deletions: number } | null;
  readonly sinceReview: { readonly showing: boolean; readonly onToggle: () => void } | null;
  /** Loading trouble for this file (retry, partial preview), when there is any. */
  readonly status?: ReactNode;
  readonly onToggleOpen: () => void;
  readonly onOpenFile: () => void;
  readonly onToggleReviewed: (path: string, reviewed: boolean) => void;
}) {
  const reviewed = props.reviewStatus === "reviewed";
  const pathClassName = cn(
    "min-w-0 flex-1 truncate text-left font-mono text-xs",
    reviewed ? "text-muted-foreground" : "text-foreground",
  );
  return (
    // The row folds and unfolds its file, as the chevron does; the controls keep their own press.
    <div
      className={cn(
        "flex h-9 w-full min-w-0 cursor-default items-center gap-2 border-b border-border py-0.5 pe-2 ps-3 font-sans",
        props.open ? "bg-card" : "bg-surface-raised",
      )}
      onClick={props.pending ? undefined : props.onToggleOpen}
    >
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="-ms-1 shrink-0"
        aria-expanded={props.open}
        aria-label={props.open ? "Collapse file" : "Expand file"}
        disabled={props.pending}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggleOpen();
        }}
      >
        {props.open ? (
          <ChevronDownIcon aria-hidden className="size-3.5" />
        ) : (
          <ChevronRightIcon aria-hidden className="size-3.5" />
        )}
      </Button>
      {props.open ? (
        // Links are underlined: with a neutral accent, hue cannot mark one.
        <button
          type="button"
          data-title
          aria-label={`Open ${props.path} in editor`}
          className={cn(
            pathClassName,
            "cursor-pointer rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenFile();
          }}
        >
          {props.path}
        </button>
      ) : (
        <span data-title className={pathClassName}>
          {props.path}
        </span>
      )}
      {props.status}
      {props.counts && props.reviewStatus !== "changed" ? (
        <DiffStat
          tone="neutral"
          additions={props.counts.additions}
          deletions={props.counts.deletions}
          className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
        />
      ) : null}
      {props.sinceReview ? (
        <Button
          type="button"
          size="compact"
          variant="ghost"
          aria-pressed={props.sinceReview.showing}
          className={cn(
            "shrink-0",
            props.sinceReview.showing && "ring-1 ring-inset ring-primary-edge",
          )}
          onClick={(event) => {
            event.stopPropagation();
            props.sinceReview?.onToggle();
          }}
        >
          {props.sinceReview.showing ? "Show all changes" : "Show only what changed"}
        </Button>
      ) : null}
      {props.reviewStatus ? (
        <DiffReviewToggle
          path={props.path}
          open={props.open}
          status={props.reviewStatus}
          onToggle={props.onToggleReviewed}
        />
      ) : null}
    </div>
  );
}
