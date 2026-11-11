/**
 * Below the new-thread composer (board 1): what needs you, what is ready to
 * review and what is working, then commits still to push. The composer stays
 * first, so an idea you arrive with is not displaced by a list of
 * obligations. With nothing waiting and nothing working, only the shortcut
 * hints show.
 */
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import {
  formatAttentionAge,
  type ThreadAttentionItem,
} from "@e6tools/client-runtime/state/thread-attention";
import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@e6tools/contracts";
import { useRouter } from "@tanstack/react-router";
import {
  CheckIcon,
  CircleAlertIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { memo, useMemo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadAttention } from "~/hooks/useThreadAttention";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { useAtomCommand } from "~/state/use-atom-command";
import { useThreadShells } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { threadNotificationFact } from "~/threadNotificationPolicy";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatShortTimestamp, formatUpcomingTimestamp } from "~/timestampFormat";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { resolveWorkingStartedAt } from "../Sidebar.logic";
import { BlockedDiamond } from "../SidebarNeedsYou";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  attentionCueVerb,
  formatAttentionCue,
  needsYouHeading,
  planSegments,
  reviewCaption,
  selectStaleSetupThread,
  selectWorkingThreads,
  workingCaption,
  type UnpushedCommits,
  type WorkingThread,
} from "./DraftHeroFooter.logic";

const HINTS: ReadonlyArray<readonly [KeybindingCommand, string]> = [
  ["chat.new", "New thread"],
  ["commandPalette.toggle", "Commands"],
  ["rightPanel.toggle", "Run details"],
  ["terminal.toggle", "Terminal"],
];

/** Each list shows this many rows; the rest stay in the sidebar. */
const LIST_LIMIT = 3;

type AttentionItem = ThreadAttentionItem<EnvironmentThreadShell>;
type OpenThread = (
  thread: { environmentId: EnvironmentId; id: ThreadId },
  options?: { diff?: boolean },
) => void;

const providerLabel = (name: string) =>
  (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[name];

const LIST_HEADING_CLASS =
  "px-0.5 text-[11px] leading-[14px] font-medium tracking-[0.01em] text-muted-foreground";
const LIST_ROW_CLASS = "flex min-w-0 items-center gap-2.5 px-0.5 py-2";
const TIME_CUE_CLASS =
  "shrink-0 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground tabular-nums";

export function DraftHeroFooter({
  keybindings,
  unpushed,
  setupProject,
  onOpenSourceControl,
}: {
  keybindings: ResolvedKeybindingsConfig;
  /** Commits on the project's branch that its remote lacks. */
  unpushed: UnpushedCommits | null;
  /** The draft's project and its resolved scripts, to flag worktrees set up with an older setup script. */
  setupProject: Parameters<typeof selectStaleSetupThread>[1];
  /** Opens Run details, where Commit pushes or opens a pull request. */
  onOpenSourceControl: () => void;
}) {
  const router = useRouter();
  const threads = useThreadShells();
  const attention = useThreadAttention();
  const blocked = useMemo(
    () => [...attention.blocked, ...attention.earlier],
    [attention.blocked, attention.earlier],
  );
  const working = useMemo(
    () => selectWorkingThreads(threads, attention, resolveWorkingStartedAt),
    [attention, threads],
  );
  const staleSetup = useMemo(
    () => selectStaleSetupThread(threads, setupProject),
    [threads, setupProject],
  );
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const hints = HINTS.flatMap(([command, label]) => {
    const shortcut = shortcutLabelForCommand(keybindings, command);
    return shortcut ? [{ shortcut, label }] : [];
  });

  const openThread: OpenThread = (thread, options) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    if (options?.diff) useRightPanelStore.getState().open(ref, "diff");
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(ref),
    });
  };

  const hasLists = blocked.length > 0 || attention.review.length > 0 || working.length > 0;
  const hasProjectRows = unpushed !== null || staleSetup !== null;
  if (!hasLists && !hasProjectRows && hints.length === 0) return null;
  return (
    // The hero hangs below a centred composer; long lists scroll in place.
    <div className="flex max-h-[42dvh] flex-col gap-6 overflow-y-auto px-1 pb-2">
      {blocked.length > 0 ? (
        <section aria-label="Needs you" className="flex flex-col gap-2">
          <h3 className={LIST_HEADING_CLASS}>{needsYouHeading(attention.blockedCount)}</h3>
          {blocked.slice(0, LIST_LIMIT).map((item) => (
            <BlockedCard key={item.key} item={item} onOpen={openThread} />
          ))}
          <MoreLine count={blocked.length - LIST_LIMIT} where="in the sidebar" />
        </section>
      ) : null}

      {attention.review.length > 0 ? (
        <section aria-label="To review" className="flex flex-col">
          <h3 className={cn(LIST_HEADING_CLASS, "pb-1")}>To review</h3>
          <ul className="flex flex-col">
            {attention.review.slice(0, LIST_LIMIT).map((item) => (
              <ReviewRow key={item.key} item={item} onOpen={openThread} />
            ))}
          </ul>
          <MoreLine count={attention.review.length - LIST_LIMIT} where="in the sidebar" />
        </section>
      ) : null}

      {working.length > 0 ? (
        <section aria-label="Working" className="flex flex-col">
          <h3 className={cn(LIST_HEADING_CLASS, "pb-1")}>Working</h3>
          <ul className="flex flex-col">
            {working.slice(0, LIST_LIMIT).map((row) => (
              <WorkingRow key={row.key} row={row} onOpen={openThread} />
            ))}
          </ul>
          <MoreLine count={working.length - LIST_LIMIT} where="in the sidebar" />
        </section>
      ) : null}

      {hasProjectRows ? (
        <section aria-label="This project" className="flex flex-col">
          <h3 className={cn(LIST_HEADING_CLASS, "pb-1")}>This project</h3>
          <ul className="flex flex-col">
            {staleSetup ? (
              // Opens the thread; its Run details re-runs the setup script there.
              // Dismissing marks the worktree as matching the current script.
              <li className={cn(LIST_ROW_CLASS, "border-border not-last:border-b")}>
                <RefreshCwIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 basis-[200px] truncate text-[13px] leading-[18px] font-medium text-foreground">
                  Setup script changed
                </span>
                <span className="min-w-0 truncate text-xs leading-4 text-muted-foreground">
                  Re-run it in <span className="font-mono">{staleSetup.branch}</span>
                </span>
                <Button size="xs" variant="ghost" onClick={() => openThread(staleSetup.thread)}>
                  Open thread
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Dismiss: keep this worktree as it is"
                  onClick={() =>
                    void updateThreadMetadata({
                      environmentId: staleSetup.thread.environmentId,
                      input: {
                        threadId: staleSetup.thread.id,
                        setupScriptHash: staleSetup.currentHash,
                      },
                    })
                  }
                >
                  <XIcon aria-hidden />
                </Button>
              </li>
            ) : null}
            {unpushed ? (
              <li className={cn(LIST_ROW_CLASS, "border-border not-last:border-b")}>
                <PullRequestGlyph.pullRequest
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 basis-[200px] truncate text-[13px] leading-[18px] font-medium text-foreground">
                  {unpushed.count} unpushed {unpushed.count === 1 ? "commit" : "commits"} on{" "}
                  <span className="font-mono text-xs">{unpushed.refName}</span>
                </span>
                <span className="min-w-0 truncate text-xs leading-4 text-muted-foreground">
                  {unpushed.hasOpenPullRequest
                    ? "Push them to update the pull request"
                    : "Push them or open a pull request"}
                </span>
                <Button size="xs" variant="ghost" onClick={onOpenSourceControl}>
                  Run details
                </Button>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {!hasLists && hints.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {hints.map((hint) => (
            <span key={hint.label} className="inline-flex items-center gap-1.5">
              <Kbd>{hint.shortcut}</Kbd>
              {hint.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MoreLine({ count, where }: { count: number; where: string }) {
  if (count <= 0) return null;
  return (
    <p className="px-0.5 pt-1 text-xs leading-4 text-muted-foreground">
      {count} more {where}
    </p>
  );
}

/** The minute clock reads "2026-11-11T14:02" in UTC; give it back its zone. */
function minuteToIso(minute: string): string {
  return `${minute}:00.000Z`;
}

/** "asked 4m ago", on the shared minute clock so only this span re-renders. */
function AttentionCue({ verb, since }: { verb: string; since: string }) {
  const nowMinute = useNowMinute();
  const cue = formatAttentionCue(verb, formatAttentionAge(since, minuteToIso(nowMinute)));
  return cue ? <span className={TIME_CUE_CLASS}>{cue}</span> : null;
}

/** "2m · since 14:02"; "<1m" in the first minute; past a day, "since Tue" alone. */
function WorkingCue({ startedAt }: { startedAt: string }) {
  const nowMinute = useNowMinute();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const age = formatAttentionAge(startedAt, minuteToIso(nowMinute));
  if (age === "") return null;
  const label = age.startsWith("since ")
    ? age
    : `${age === "now" ? "<1m" : age} · since ${formatShortTimestamp(startedAt, timestampFormat)}`;
  return <span className={TIME_CUE_CLASS}>{label}</span>;
}

const BLOCKED_ACTION = {
  approval: "Review",
  input: "Answer",
  failed: "Open thread",
} as const;

/**
 * One thread blocked on you. Phase 17 expands the first approval with its
 * real actions; until then every card opens its thread.
 */
const BlockedCard = memo(function BlockedCard({
  item,
  onOpen,
}: {
  item: AttentionItem;
  onOpen: OpenThread;
}) {
  const kind = item.kind as keyof typeof BLOCKED_ACTION;
  const fact = threadNotificationFact(
    item.thread,
    kind === "approval" ? "approval" : kind === "input" ? "input" : "failed",
    providerLabel,
  );
  return (
    <article
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-xl border bg-card px-4 py-3",
        kind === "failed" ? "border-destructive-foreground" : "border-warning-foreground",
      )}
    >
      <span className="inline-flex w-4 shrink-0 justify-center">
        {kind === "approval" ? (
          <BlockedDiamond />
        ) : kind === "input" ? (
          <MessageCircleQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
        ) : (
          <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-0.5">
        <h4 className="truncate text-[13px] leading-[18px] font-medium text-foreground">
          {item.thread.title}
        </h4>
        {fact ? <p className="truncate text-xs leading-4 text-muted-foreground">{fact}.</p> : null}
      </div>
      <AttentionCue verb={attentionCueVerb(item.kind)} since={item.since} />
      <Button size="sm" variant="outline" onClick={() => onOpen(item.thread)}>
        {BLOCKED_ACTION[kind]}
      </Button>
    </article>
  );
});

const ReviewRow = memo(function ReviewRow({
  item,
  onOpen,
}: {
  item: AttentionItem;
  onOpen: OpenThread;
}) {
  const isPlan = item.kind === "plan";
  return (
    <li className={cn(LIST_ROW_CLASS, "flex-wrap border-border not-last:border-b")}>
      {isPlan ? (
        <ListChecksIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <CheckIcon aria-hidden className="size-4 shrink-0 text-success-foreground" />
      )}
      <span className="min-w-0 flex-1 basis-[200px] truncate text-[13px] leading-[18px] font-medium text-foreground">
        {item.thread.title}
      </span>
      <span className="shrink-0 text-xs leading-4 text-muted-foreground">
        {reviewCaption(isPlan ? "plan" : "done", item.thread.latestTurn?.diffStat)}
      </span>
      <AttentionCue verb={attentionCueVerb(item.kind)} since={item.since} />
      <Button size="xs" variant="ghost" onClick={() => onOpen(item.thread, { diff: !isPlan })}>
        {isPlan ? "Review plan" : "Review diff"}
      </Button>
    </li>
  );
});

const WorkingRow = memo(function WorkingRow({
  row,
  onOpen,
}: {
  row: WorkingThread;
  onOpen: OpenThread;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { thread } = row;
  const progress = thread.agentState ? null : thread.planProgress;
  const segments = progress ? planSegments(progress) : [];
  const caption = workingCaption(thread, (resetsAt) =>
    formatUpcomingTimestamp(resetsAt, timestampFormat),
  );
  return (
    <li className="border-border not-last:border-b">
      <button
        type="button"
        onClick={() => onOpen(thread)}
        className={cn(
          LIST_ROW_CLASS,
          "w-full cursor-pointer rounded-md text-left outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span
          aria-hidden
          className="mx-1 size-2 shrink-0 rounded-full bg-primary ring-3 ring-primary-surface"
        />
        <span className="min-w-0 shrink truncate text-[13px] leading-[18px] font-medium text-foreground">
          {thread.title}
        </span>
        {segments.length > 0 && progress ? (
          <span
            role="img"
            aria-label={`Step ${Math.min(progress.completedSteps + 1, progress.totalSteps)} of ${progress.totalSteps}`}
            className="flex shrink-0 gap-[3px]"
          >
            {segments.map((segment, index) => (
              <span
                // Segments have no identity beyond their position.
                // oxlint-disable-next-line react/no-array-index-key
                key={index}
                className={cn(
                  "h-1.5 w-3.5 rounded-full",
                  segment === "done"
                    ? "bg-success"
                    : segment === "live"
                      ? "bg-primary"
                      : "ring-1 ring-muted-foreground ring-inset",
                )}
              />
            ))}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">
          {caption}
        </span>
        {row.startedAt ? <WorkingCue startedAt={row.startedAt} /> : null}
      </button>
    </li>
  );
});
