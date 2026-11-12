/**
 * Loading states specific to the pull request surface — the first list, a search under way,
 * and a detail panel opening — use bars in the geometry of the content they stand for, pulsing
 * on one composited layer. Diff loading uses the shared diff-panel skeleton instead.
 *
 * The bars share the app-wide `Skeleton` tone (`muted-foreground` at low alpha, which reads on
 * both themes) and the single `animate-skeleton` pulse, applied once on the container so any
 * number of bars costs one opacity animation.
 */
import type { PullRequestListEntry, PullRequestSummary } from "@e6tools/contracts";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PanelRightIcon,
  TagIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { pullRequestCodeTabLabel } from "./pullRequestDetail.logic";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { MiddleTruncate } from "../ui/middle-truncate";
import { PullRequestLabelChip, resolvePullRequestState } from "./pullRequestPresentation";

function GhostBar({ className }: { className?: string | undefined }) {
  return <div aria-hidden className={cn("h-3 rounded bg-muted-foreground/15", className)} />;
}

/** Widths cycle rather than randomize, so the ghost renders the same on every pass. */
const TITLE_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-2/5", "w-3/5", "w-1/2"];
const META_WIDTHS = ["w-2/5", "w-1/3", "w-2/5", "w-1/4", "w-1/3", "w-2/5", "w-1/3"];
const DEFAULT_DETAIL_TABS = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
] as const;

/** Rows in the list's own grid — glyph, title over meta, time over diffstat. */
export function PullRequestListGhost({
  rows = 7,
  caption,
}: {
  rows?: number;
  /** Said where the group headers speak, for the states with something to say — a search. */
  caption?: string;
}) {
  return (
    <div
      role="status"
      aria-label={caption ?? "Loading pull requests"}
      className="motion-safe:animate-skeleton space-y-1"
    >
      {caption ? (
        <p className="px-3 pb-1 text-xs font-medium text-muted-foreground/70">{caption}</p>
      ) : null}
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[10px] p-3"
        >
          <GhostBar className="size-4 rounded-full" />
          <GhostBar className={cn("h-4", TITLE_WIDTHS[index % TITLE_WIDTHS.length])} />
          <GhostBar className="h-[22px] w-20 rounded-md" />
          <span aria-hidden />
          <GhostBar className={cn("h-3", META_WIDTHS[index % META_WIDTHS.length])} />
          <GhostBar className="ml-auto w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * The detail panel's current expanded shape. Keeping the chrome, summary facts, and description
 * boundaries in the ghost prevents the loaded pull request from replacing one layout with
 * another a moment later.
 */
export function PullRequestDetailGhost({
  seed: entry,
  summary,
  actions,
  tabs = DEFAULT_DETAIL_TABS,
  activeTab,
  number,
  onBack,
  onClose,
}: {
  seed?: PullRequestListEntry | null;
  summary?: PullRequestSummary | null;
  actions?: ReactNode;
  tabs?: ReadonlyArray<{ value: string; label: string }>;
  /** The panel's current tab, so the highlight does not jump when the detail arrives. */
  activeTab?: string;
  number?: number;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  const seed = summary
    ? {
        ...entry,
        ...summary,
        isDraft: summary.isDraft ?? entry?.isDraft,
      }
    : entry;
  const statePresentation = seed
    ? resolvePullRequestState({
        state: seed.state,
        isDraft: seed.isDraft ?? false,
      })
    : null;
  const changedFiles = summary?.changedFiles ?? null;
  const selectedTab =
    tabs.find((item) => item.value === activeTab)?.value ?? tabs[0]?.value ?? "summary";

  // The loaded panel's header, line for line, so nothing moves when the detail arrives.
  return (
    <div
      role="status"
      aria-label="Loading pull request"
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background",
        !seed && "motion-safe:animate-skeleton",
      )}
    >
      <div className="min-w-0 shrink-0 border-b border-border">
        <div className="flex min-w-0 items-start gap-2.5 pt-3 pr-3 pb-2.5 pl-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-h-6 min-w-0 items-center gap-1">
              {onBack ? (
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  className="-ml-1.5"
                  onClick={onBack}
                  aria-label="Back to this thread's pull requests"
                >
                  <ArrowLeftIcon aria-hidden className="size-3.5" />
                </Button>
              ) : null}
              {seed ? (
                <h2 className="min-w-0 flex-1 truncate text-lg leading-6 font-semibold tracking-[-0.015em]">
                  {seed.title}
                </h2>
              ) : (
                <GhostBar className="h-5 w-4/5 max-w-md" />
              )}
            </div>
            <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-2">
              {statePresentation ? (
                <Badge variant="outline" className="shrink-0 text-muted-foreground">
                  <statePresentation.Icon aria-hidden className="size-3" />
                  {statePresentation.label}
                </Badge>
              ) : (
                <GhostBar className="h-5 w-14 rounded" />
              )}
              {seed ? (
                <InlineButton
                  onClick={() => void readLocalApi()?.shell.openExternal(seed.url)}
                  className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  aria-label={`Open pull request #${seed.number} on host`}
                >
                  #{seed.number}
                </InlineButton>
              ) : (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  #{number ?? "…"}
                </span>
              )}
              {seed ? (
                <span className="flex min-w-0 max-w-full items-center gap-1 rounded bg-surface-well px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  <span className="min-w-0 truncate">{seed.headBranch}</span>
                  <span aria-label="merges into" className="shrink-0 text-muted-foreground">
                    →
                  </span>
                  <code className="flex min-w-0">
                    <MiddleTruncate value={seed.baseBranch} />
                  </code>
                </span>
              ) : (
                <GhostBar className="h-5 w-40 rounded" />
              )}
              {seed?.createdAt ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  opened {formatRelativeTimeLabel(seed.createdAt)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1">
            {actions}
            <Button
              size="icon-xs"
              variant="ghost"
              disabled
              aria-label="Pull request actions loading"
            >
              <EllipsisIcon aria-hidden className="size-4" />
            </Button>
            {onClose ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Collapse pull request panel"
                onClick={onClose}
              >
                <PanelRightIcon aria-hidden className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        <nav
          className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-2.5"
          aria-label="Pull request tabs"
          inert
        >
          <ToggleGroup
            className="shrink-0"
            size="segmented"
            variant="segmented"
            value={[selectedTab]}
          >
            {tabs.map((tab) => (
              <Toggle key={tab.value} value={tab.value} tabIndex={-1}>
                {tab.value === "code" && changedFiles !== null
                  ? pullRequestCodeTabLabel(changedFiles)
                  : tab.label}
              </Toggle>
            ))}
          </ToggleGroup>
        </nav>
      </div>

      <div className={cn("space-y-[18px] px-4 pt-4", seed && "motion-safe:animate-skeleton")}>
        {/* The next step card and the merge readiness list, still being read. */}
        <div className="space-y-2.5 rounded-xl border border-border bg-card px-4 py-3.5">
          <GhostBar className="h-4 w-48" />
          <GhostBar className="w-4/5" />
        </div>
        <div className="space-y-2">
          <span className="text-sm font-semibold">Merge readiness</span>
          <div className="space-y-3.5 rounded-xl border border-border bg-surface-raised px-3 py-3.5">
            {["w-28", "w-20", "w-24", "w-32"].map((width) => (
              <div key={width} className="flex items-center gap-2.5">
                <GhostBar className="size-3.5 rounded-sm" />
                <GhostBar className={width} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <section className="px-4 pt-2.5 pb-1">
          <div className="space-y-2">
            <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <UsersIcon aria-hidden className="size-3.5" />
                Reviewers
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <GhostBar className="h-3 w-10" />
                <Button size="icon-xs" variant="ghost" disabled aria-label="Reviewers loading">
                  <UserPlusIcon aria-hidden className="size-3.5" />
                </Button>
              </span>
            </div>
            <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <TagIcon aria-hidden className="size-3.5" />
                Labels
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-1 text-foreground">
                {entry?.labels ? (
                  entry.labels.length > 0 ? (
                    entry.labels.map((label) => (
                      <PullRequestLabelChip
                        key={label.name}
                        label={label}
                        size="default"
                        className="max-w-48"
                      />
                    ))
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )
                ) : (
                  <>
                    <GhostBar className="h-4.5 w-24" />
                    <GhostBar className="h-4.5 w-20" />
                  </>
                )}
                <Button size="icon-xs" variant="ghost" disabled aria-label="Labels loading">
                  <TagIcon aria-hidden className="size-3.5" />
                </Button>
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className="sticky top-0 z-10 flex w-full items-center bg-background pr-4">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              <span>Description</span>
              <ChevronRightIcon
                aria-hidden
                className="size-3.5 rotate-90 text-muted-foreground/60"
              />
            </div>
          </div>
          <div className="space-y-3 px-4 pb-4">
            <GhostBar className="h-5 w-40" />
            <div className="space-y-2">
              <GhostBar className="h-4 w-full" />
              <GhostBar className="h-4 w-11/12" />
              <GhostBar className="h-4 w-4/5" />
              <GhostBar className="h-4 w-2/3" />
            </div>
          </div>
        </section>
      </div>

      {/* The merge footer's space, so it does not pop in under an open pull request. */}
      {!seed || seed.state === "open" ? (
        <div
          aria-hidden
          className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2.5"
        >
          <GhostBar className="h-4 w-16" />
          <span className="flex-1 basis-36" />
          <GhostBar className="h-9 w-32 rounded-lg sm:h-8" />
          <GhostBar className="h-9 w-36 rounded-lg sm:h-8" />
        </div>
      ) : null}
    </div>
  );
}

/** People-shaped: an avatar and a name, in the reviewer picker's own row height. */
export function PullRequestPeopleGhost({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading people"
      className="motion-safe:animate-skeleton space-y-1 p-1"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-7 items-center gap-2 rounded-md px-2">
          <GhostBar className="size-4 rounded-full" />
          <GhostBar className={META_WIDTHS[index % META_WIDTHS.length]} />
        </div>
      ))}
    </div>
  );
}

/** The timeline's own shape: dots on the rail, a line and a date to each. */
export function PullRequestTimelineGhost({ rows = 6 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading timeline"
      className="motion-safe:animate-skeleton px-4 py-5"
    >
      <div className="relative ml-2 border-l border-border/70 pl-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="relative pb-5">
            <GhostBar className="absolute -left-[1.55rem] top-1 size-2 rounded-full" />
            <GhostBar className={cn("h-3.5", TITLE_WIDTHS[index % TITLE_WIDTHS.length])} />
            <GhostBar className="mt-1.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A compact placeholder for the conversation while the core detail is already readable. */
export function PullRequestConversationGhost({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading pull request conversation"
      className="motion-safe:animate-skeleton space-y-4 py-2"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-2">
          <GhostBar className="size-5 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <GhostBar className={META_WIDTHS[index % META_WIDTHS.length]} />
            <GhostBar className="w-full" />
            <GhostBar className="w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
