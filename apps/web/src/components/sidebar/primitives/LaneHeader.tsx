import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleDashed,
  Pin,
  ShieldQuestion,
  type LucideIcon,
} from "lucide-react";
import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type {
  LanePullRequestState,
  LanePullRequestSummary,
  SidebarStatusSectionKey,
} from "../../Sidebar.logic";
import { SIDEBAR_STATUS_SECTION_LABELS } from "../../Sidebar.logic";
import { BranchLabel } from "./BranchLabel";
import { CountBadge } from "./CountBadge";

const STATUS_SECTION_ICONS: Record<SidebarStatusSectionKey, { icon: LucideIcon; color?: string }> =
  {
    "needs-you": { icon: ShieldQuestion, color: "var(--state-approval)" },
    error: { icon: CircleAlert },
    running: { icon: CircleDashed },
    idle: { icon: Circle },
  };

const PR_STATE_COLOR: Record<LanePullRequestState, string> = {
  open: "var(--state-completed)",
  merged: "var(--state-plan)",
  closed: "var(--state-error)",
  draft: "var(--sb-muted)",
};

export function threadCountLabel(count: number): string {
  return count === 1 ? "thread" : "threads";
}

/** The lane toggle's spoken PR summary; the visible one is aria-hidden. */
function pullRequestLabel(pr: LanePullRequestSummary): string {
  const shown = `#${pr.number}${pr.state ? ` ${pr.state}` : ""}`;
  return pr.count > 1 ? `${pr.count} pull requests, showing ${shown}` : `pull request ${shown}`;
}

/**
 * A lane or section header. With `onToggle` the label, count and chevron form
 * one toggle whose accessible name is its visible text plus sr-only suffixes
 * (WCAG 2.5.3); live state, the pull request and the clean-up link sit beside
 * it, never inside. A status section is a heading with an empty chevron slot.
 */
export function LaneHeader({
  branch,
  count,
  expanded = true,
  onToggle,
  worktree = false,
  pinned = false,
  status,
  projectName,
  live = false,
  pullRequest = null,
  cleanUp = false,
  containsOpenThread = false,
  cleanUpLink,
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
  /** Status-mode section header: a heading, never a toggle. */
  status?: SidebarStatusSectionKey;
  projectName?: string | undefined;
  /** Any lane thread is working, connecting or monitoring. */
  live?: boolean;
  pullRequest?: LanePullRequestSummary | null;
  /** The chosen pull request is merged while its worktree still exists. */
  cleanUp?: boolean;
  /** A collapsed lane holds the open thread: draw the rail and say so. */
  containsOpenThread?: boolean;
  /** Renders the clean-up link; defaults to a router link to Storage settings. */
  cleanUpLink?: ReactElement<{ "aria-label"?: string; className?: string }>;
  metadata?: ReactNode;
  actions?: ReactNode;
  controlsId?: string;
  className?: string;
}) {
  const descriptionId = useId();
  const marked = containsOpenThread && !expanded;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // The count speaks the toggle's sr-only suffixes: "3 threads", then the
  // pull request the aria-hidden meta shows. One label keeps the spoken
  // phrase together; separate flex items are read with a gap between them.
  const countBadge = (
    <CountBadge
      count={count}
      label={
        pullRequest !== null && onToggle && !status
          ? `${threadCountLabel(count)}, ${pullRequestLabel(pullRequest)}`
          : threadCountLabel(count)
      }
    />
  );
  const showPr = pullRequest !== null && !cleanUp;
  const label = status ? (
    (() => {
      const { icon: Icon, color } = STATUS_SECTION_ICONS[status];
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-sb-foreground">
          <Icon
            aria-hidden="true"
            className="size-3 shrink-0 text-sb-muted"
            style={color ? { color } : undefined}
            strokeWidth={1.75}
          />
          {SIDEBAR_STATUS_SECTION_LABELS[status]}
        </span>
      );
    })()
  ) : pinned ? (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-sb-foreground">
      <Pin aria-hidden="true" className="size-3 shrink-0 text-sb-muted" strokeWidth={1.75} />
      Pinned
    </span>
  ) : (
    <>
      {/* The prefix gives way first but keeps a few characters: lane meta now
          shares the row, and a one-letter prefix names nothing. */}
      {projectName && (
        <span className="max-w-[72px] min-w-8 shrink-[4] truncate">{projectName} /</span>
      )}
      <BranchLabel branch={branch} worktree={worktree} lane showWorktreeTag={!cleanUp} />
    </>
  );
  const chevronSlot = (
    // The slot keeps titles aligned whether or not there is a chevron. With
    // the open-thread rail, an 8px surface band knocks the rail out behind it.
    <span
      aria-hidden="true"
      className={cn(
        "relative z-[1] flex h-2 w-3.5 shrink-0 items-center justify-center",
        marked && "bg-sb-surface",
      )}
    >
      {onToggle && <Chevron className="size-3" strokeWidth={1.75} />}
    </span>
  );
  const meta = (
    <>
      {live && (
        <span className="inline-flex items-center gap-1">
          <span
            role="img"
            aria-label="Live work"
            className="size-1.5 shrink-0 rounded-full bg-(--state-working)"
          />
          <span aria-hidden="true" className="@max-[360px]/sidebar-column:hidden">
            live
          </span>
        </span>
      )}
      {showPr && (
        <span
          aria-hidden="true"
          data-sb-lane-pr={pullRequest.state ?? "unknown"}
          className="inline-flex items-center gap-1"
        >
          <span
            style={{
              color: pullRequest.state ? PR_STATE_COLOR[pullRequest.state] : "var(--sb-muted)",
            }}
          >
            PR #{pullRequest.number}
          </span>
          {pullRequest.count > 1 && (
            <span className="text-sb-muted @max-[280px]/sidebar-column:hidden">
              +{pullRequest.count - 1}
            </span>
          )}
        </span>
      )}
      {cleanUp && pullRequest !== null && (
        <Tooltip>
          <TooltipTrigger
            render={cloneElement(cleanUpLink ?? <Link to="/settings/storage" />, {
              "aria-label": `PR #${pullRequest.number} merged · clean up?`,
              className: "rounded-sm text-(--state-plan) underline-offset-2 hover:underline",
            })}
          >
            merged · clean up?
          </TooltipTrigger>
          <TooltipPopup>
            PR #{pullRequest.number} merged. Remove its worktree in Storage.
          </TooltipPopup>
        </Tooltip>
      )}
      {metadata}
    </>
  );
  const hasMeta = live || pullRequest !== null || metadata !== undefined;
  return (
    <div
      data-sb-lane-header
      className={cn(
        "relative flex h-7 min-w-0 items-center gap-1.5 rounded-md pr-1 pl-0.5 text-(length:--sb-text-meta) text-sb-muted",
        className,
      )}
    >
      {marked && (
        <span
          aria-hidden="true"
          data-sb-open-thread-mark
          className="pointer-events-none absolute top-[3px] bottom-[3px] left-2 w-0.5 rounded-full bg-sb-accent"
        />
      )}
      {status ? (
        <div role="heading" aria-level={3} className="flex min-w-0 flex-1 items-center gap-1.5">
          {chevronSlot}
          {label}
          {countBadge}
        </div>
      ) : onToggle ? (
        <Button
          variant="chip"
          className="sb-action h-7 min-w-0 flex-1 justify-start gap-1.5 pl-0"
          aria-expanded={expanded}
          aria-controls={controlsId}
          aria-describedby={marked ? descriptionId : undefined}
          onClick={onToggle}
        >
          {chevronSlot}
          {label}
          {countBadge}
        </Button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {label}
          {countBadge}
        </div>
      )}
      {marked && (
        <span id={descriptionId} hidden>
          contains the open thread
        </span>
      )}
      {hasMeta && (
        <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">{meta}</span>
      )}
      {actions}
    </div>
  );
}
