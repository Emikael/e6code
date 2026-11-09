import {
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  EyeIcon,
  SearchIcon,
  TriangleAlertIcon,
  UserRoundXIcon,
  type LucideIcon,
} from "lucide-react";
import { PullRequestStackPopover } from "./PullRequestStackPopover";
import { memo, type RefCallback } from "react";

import { cn } from "~/lib/utils";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";

import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestGlyph } from "./pullRequestIcons";
import { PullRequestRowThreads } from "./PullRequestRowThreads";
import {
  pullRequestRowStatusStatesReview,
  pullRequestRowThreadKey,
  resolvePullRequestRowStatus,
  type PullRequestRowStatus,
  type PullRequestRowStatusKind,
  type PullRequestStatusTone,
} from "./pullRequestTriage.logic";
import { PullRequestChecksPopover } from "./PullRequestChecksPopover";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import { openOnHostLabel, showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";
import {
  PullRequestRowAuthor,
  PullRequestRowBranches,
  PullRequestRowGlyph,
} from "./PullRequestListRow";
import {
  PullRequestDiffStat,
  PullRequestLabelChip,
  PullRequestMetaLine,
  PullRequestReviewDecisionGlyph,
} from "./pullRequestPresentation";
import { formatRelativeTimeLabel } from "~/timestampFormat";

/**
 * Each slot past the first only appears once the meta line is wide enough to hold it, so a
 * narrow row shows one label and a "+N" while a wide one spreads out up to three. The "+N"
 * rides on whichever pill is the last visible one, and is hidden as soon as the next slot shows.
 */
const LABEL_SLOTS = [
  { pill: "", overflow: "@xl/pr-row-meta:hidden" },
  { pill: "hidden @xl/pr-row-meta:inline-flex", overflow: "@3xl/pr-row-meta:hidden" },
  { pill: "hidden @3xl/pr-row-meta:inline-flex", overflow: "" },
] as const;

function PullRequestRowLabels({ labels }: { labels: EnvironmentPullRequestEntry["labels"] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {LABEL_SLOTS.map((slot, index) => {
        const label = labels[index];
        if (!label) return null;
        const remaining = labels.length - index - 1;
        return (
          <PullRequestLabelChip key={label.name} label={label} className={slot.pill}>
            {remaining > 0 ? (
              <span className={cn("shrink-0", slot.overflow)}>+{remaining}</span>
            ) : null}
          </PullRequestLabelChip>
        );
      })}
    </span>
  );
}

const STATUS_TONE_BADGE = {
  success: "success",
  warning: "warning",
  destructive: "error",
  info: "info",
  muted: "secondary",
} as const satisfies Record<PullRequestStatusTone, string>;

const STATUS_ICONS: Record<PullRequestRowStatusKind, LucideIcon> = {
  ready: CircleCheckIcon,
  review: EyeIcon,
  "changes-requested": UserRoundXIcon,
  "checks-failing": CircleXIcon,
  conflicts: TriangleAlertIcon,
  "checks-running": CircleDashedIcon,
  "awaiting-review": ClockIcon,
  "checks-passed": CheckIcon,
  draft: PullRequestGlyph.draft,
  open: CircleDotIcon,
  merged: PullRequestGlyph.merged,
  closed: PullRequestGlyph.closed,
};

/** A row's worded state: icon and words in one semantic tone, so colour never carries it alone. */
function PullRequestStatusChip({ status }: { status: PullRequestRowStatus }) {
  const Icon = STATUS_ICONS[status.kind];
  return (
    <Badge
      size="sm"
      variant={STATUS_TONE_BADGE[status.tone]}
      className="h-[22px] gap-1 rounded-md px-1.5 text-xs font-medium"
    >
      <Icon aria-hidden className="size-3" />
      {status.label}
    </Badge>
  );
}

/**
 * The page row: the lifecycle glyph, then the title over a mono meta line, with the worded
 * status on the right of the title and the line counts under it. The intrinsic size is the
 * content box a skipped row reserves: a 22px title line and a 16px meta line, 4px apart.
 */
const PAGE_ROW_CLASS =
  "grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[10px] p-3 text-left [contain-intrinsic-block-size:42px]";

export type PullRequestRowTarget = Pick<
  EnvironmentPullRequestEntry,
  "environmentId" | "projectId" | "host" | "repository" | "number"
>;

function PullRequestRowImpl({
  entry,
  selected,
  showProjectTitle,
  showProvider,
  environmentLabel,
  matchedElsewhere,
  authoredByViewer,
  statsKey,
  statsRef,
  onSelect,
}: {
  entry: EnvironmentPullRequestEntry;
  selected: boolean;
  /** The signed-in account on this row's host wrote it, which turns "review" into "yours". */
  authoredByViewer: boolean;
  showProjectTitle: boolean;
  /** Only when the list spans more than one host, where the repository alone is ambiguous. */
  showProvider: boolean;
  /** Names the server this row was read from, where the list spans more than one. */
  environmentLabel?: string;
  /**
   * A search found this, but in something the row does not show — a description, a comment, a
   * commit message. Saying so is the difference between a result and an apparently random row.
   */
  matchedElsewhere?: boolean;
  /** Used by the list's shared visibility observer to defer optional line-count reads. */
  statsKey?: string;
  statsRef?: RefCallback<HTMLButtonElement>;
  onSelect: (entry: PullRequestRowTarget) => void;
}) {
  const { Icon, providerName } = getSourceControlPresentationForKind(entry.provider);
  const status = resolvePullRequestRowStatus(entry, authoredByViewer);
  return (
    // The row's action is a button laid behind the content rather than around it, so the
    // linked-thread link and the checks and stack menus are its siblings, not nested inside a
    // button. It comes first, so Tab still reaches the row before its controls. A click anywhere
    // on the row bubbles here; the inner controls stop their own clicks.
    <div
      onClick={() => onSelect(entry)}
      className={cn(
        PAGE_ROW_CLASS,
        "group/pr-row relative isolate w-full cursor-pointer transition-colors",
        // Offscreen rows are skipped for style, layout and paint: a long list costs what the
        // viewport shows, not what the pages have loaded. The intrinsic size keeps the
        // scrollbar honest while a row is skipped.
        "[content-visibility:auto]",
        // The selection is a wash and a ring, so it reads without relying on the fill alone.
        selected ? "bg-primary-surface ring-1 ring-primary/25 ring-inset" : "hover:bg-accent/60",
      )}
    >
      <button
        ref={statsRef}
        data-pull-request-stats-key={statsKey}
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={`#${entry.number} ${entry.title}, ${status.label}`}
        // Inset: the row's paint containment would clip a ring drawn outside it.
        className="absolute inset-0 -z-10 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      />
      {/* No conflict badge on the glyph: the status chip always words a conflict. */}
      <PullRequestRowGlyph state={entry.state} isDraft={entry.isDraft} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
          {entry.title}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          {/* Kept beside the title because it opens the check list, which the words cannot. */}
          {entry.checksState === undefined ? null : (
            <PullRequestChecksPopover
              checksState={entry.checksState}
              environmentId={entry.environmentId}
              reference={{
                projectId: entry.projectId,
                repository: entry.repository,
                number: entry.number,
              }}
            />
          )}
          {/* Only a verdict the host actually reports: an approval, a request for changes,
                or a review the branch rules still require. No glyph on the common case of a
                pull request nobody has reviewed, so a row only wears a person when the person
                has said something, and only where the chip has not already said it. */}
          {entry.reviewDecision === undefined ||
          pullRequestRowStatusStatesReview(status.kind) ? null : (
            <PullRequestReviewDecisionGlyph decision={entry.reviewDecision} />
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1.5 text-[11px]">
        <PullRequestRowThreads threadKey={pullRequestRowThreadKey(entry)} />
        <PullRequestStatusChip status={status} />
      </span>
      <span aria-hidden />
      <span className="@container/pr-row-meta min-w-0 overflow-hidden font-mono text-[11px] leading-4 text-muted-foreground">
        <PullRequestMetaLine className="overflow-hidden whitespace-nowrap">
          {/* The number carries the link, here as much as on the detail: a right-click on it
              copies the pull request's own address rather than opening the editing menu. */}
          <span
            key="number"
            className="shrink-0 tabular-nums"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void showPullRequestLinkContextMenu({
                url: entry.url,
                openLabel: openOnHostLabel(entry.provider),
                position: { x: event.clientX, y: event.clientY },
              });
            }}
          >
            #{entry.number}
          </span>
          {/* Said here only where the chip is busy saying something else. */}
          {entry.isDraft && status.kind !== "draft" ? (
            <span key="draft" className="shrink-0">
              draft
            </span>
          ) : null}
          <span key="branches" className="flex min-w-0">
            <PullRequestRowBranches head={entry.headBranch} base={entry.baseBranch} />
          </span>
          <PullRequestRowAuthor
            key="author"
            actor={entry.author}
            className="min-w-3.5 max-w-40 shrink-0"
            labelClassName="sr-only @xs/pr-row-meta:not-sr-only @xs/pr-row-meta:truncate"
          />
          {entry.updatedAt ? (
            <span key="updated" className="shrink-0 tabular-nums">
              {formatRelativeTimeLabel(entry.updatedAt)}
            </span>
          ) : null}
          {status.detail ? (
            <span
              key="detail"
              className={cn("shrink-0", status.tone === "destructive" && "text-error-foreground")}
            >
              {status.detail}
            </span>
          ) : null}
          {showProjectTitle ? (
            <span key="repository" className="min-w-0 truncate">
              {entry.repository}
            </span>
          ) : null}
          {environmentLabel ? (
            <span key="environment" className="min-w-0 max-w-32 truncate">
              {environmentLabel}
            </span>
          ) : null}
          {showProvider ? (
            <Tooltip key="provider">
              <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                <Icon aria-label={providerName} className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>{providerName}</TooltipPopup>
            </Tooltip>
          ) : null}
          {matchedElsewhere ? (
            <Tooltip key="matched">
              <TooltipTrigger
                render={
                  <span className="flex min-w-6 shrink-0 items-center gap-1 overflow-hidden rounded-full border border-border/60 px-1 font-sans text-[10px]" />
                }
              >
                <span className="sr-only">matched in the description</span>
                <SearchIcon aria-hidden className="size-3 shrink-0" />
                <span aria-hidden className="hidden truncate @xs/pr-row-meta:block">
                  matched in the description
                </span>
              </TooltipTrigger>
              <TooltipPopup side="top">Matched in the description</TooltipPopup>
            </Tooltip>
          ) : null}
          {entry.labels.length > 0 ? (
            <span key="labels" className="flex min-w-0 font-sans">
              <PullRequestRowLabels labels={entry.labels} />
            </span>
          ) : null}
        </PullRequestMetaLine>
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1.5 text-[11px]">
        {entry.stack ? (
          <PullRequestStackPopover
            environmentId={entry.environmentId}
            reference={{
              projectId: entry.projectId,
              host: entry.host,
              repository: entry.repository,
              number: entry.number,
            }}
            membership={entry.stack}
            onSelect={(target) =>
              onSelect({ ...target, host: entry.host, environmentId: entry.environmentId })
            }
          />
        ) : null}
        <PullRequestDiffStat
          additions={entry.additions}
          deletions={entry.deletions}
          className="font-mono"
        />
      </span>
    </div>
  );
}

/**
 * Memoized: the list re-renders on every keystroke of a search and every status poll, and a
 * row whose entry, selection and match state are unchanged has nothing new to say. Effective
 * because the route hands it a stable `onSelect`.
 */
export const PullRequestRow = memo(PullRequestRowImpl);
