/**
 * Below the new-thread composer (board 1): what needs you, what is ready to
 * review and what is working. The composer stays
 * first, so an idea you arrive with is not displaced by a list of
 * obligations. With nothing waiting and nothing working, only the shortcut
 * hints show.
 */
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import {
  formatAttentionAge,
  formatElapsedAge,
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
import { CheckIcon, ListChecksIcon, MessageCircleQuestionIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useParkedActions } from "~/hooks/useParkedActions";
import {
  localDateKey,
  openParkedList,
  removeParkedEntry,
  selectParkedChips,
} from "~/parkedThoughts";
import { usePromptStashStore, type PromptStashEntry } from "~/promptStashStore";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadAttention } from "~/hooks/useThreadAttention";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { useThreadShells } from "~/state/entities";
import { threadNotificationFact } from "~/threadNotificationPolicy";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatShortTimestamp, formatUpcomingTimestamp } from "~/timestampFormat";
import {
  resolveWorkingStartedAt,
  runningThreadMarkKind,
  THREAD_STATUS_MARKS,
} from "../Sidebar.logic";
import { BlockedDiamond } from "../SidebarNeedsYou";
import { THREAD_STATUS_TONE_TEXT, ThreadStatusMarker } from "../ThreadStatusMarker";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  asSentence,
  attentionCueVerb,
  formatAttentionCue,
  needsYouHeading,
  reviewCaption,
  selectStartScreenBlocked,
  selectWorkingThreads,
  workingCaption,
  type WorkingThread,
} from "./DraftHeroFooter.logic";
import { PlanStepMeter } from "./PlanStepMeter";
import { StartScreenApprovalCard } from "./StartScreenApprovalCard";
import { useWhatChangedVisible, WhatChangedCard } from "./WhatChangedCard";

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
  composerHasText,
}: {
  keybindings: ResolvedKeybindingsConfig;
  /** The composer holds a draft: Send has the screen's one fill, so Approve gives it up. */
  composerHasText: boolean;
}) {
  const router = useRouter();
  const threads = useThreadShells();
  const attention = useThreadAttention();
  // Board 1 lists what asks you something; failed threads stay in the sidebar's Needs you.
  const blocked = useMemo(
    () => selectStartScreenBlocked([...attention.blocked, ...attention.earlier]),
    [attention.blocked, attention.earlier],
  );
  const working = useMemo(
    () => selectWorkingThreads(threads, attention, resolveWorkingStartedAt),
    [attention, threads],
  );
  const hints = HINTS.flatMap(([command, label]) => {
    const shortcut = shortcutLabelForCommand(keybindings, command);
    return shortcut ? [{ shortcut, label }] : [];
  });

  const openThread = useCallback<OpenThread>(
    (thread, options) => {
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      if (options?.diff) useRightPanelStore.getState().open(ref, "diff");
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
    },
    [router],
  );

  // Only the first approval shown opens up, so the start screen holds one thread's detail.
  const expandedApprovalKey =
    blocked.slice(0, LIST_LIMIT).find((item) => item.kind === "approval")?.key ?? null;
  const hasLists = blocked.length > 0 || attention.review.length > 0 || working.length > 0;
  const parkedEntries = usePromptStashStore((store) => store.entries);
  const nowMinute = useNowMinute();
  const today = localDateKey(Date.parse(minuteToIso(nowMinute)));
  const parked = useMemo(() => selectParkedChips(parkedEntries, today), [parkedEntries, today]);
  const showWhatChanged = useWhatChangedVisible();
  if (!hasLists && hints.length === 0 && parked.chips.length === 0 && !showWhatChanged) {
    return null;
  }
  return (
    // Sits in the start screen's flow; long lists scroll the page with it.
    <div className="flex flex-col gap-6">
      {parked.chips.length > 0 ? <ParkedChips chips={parked.chips} more={parked.more} /> : null}
      {showWhatChanged ? <WhatChangedCard /> : null}
      {blocked.length > 0 ? (
        <section aria-label="Needs you" className="flex flex-col gap-2">
          <h3 className={LIST_HEADING_CLASS}>{needsYouHeading(blocked.length)}</h3>
          {blocked
            .slice(0, LIST_LIMIT)
            .map((item) =>
              item.key === expandedApprovalKey ? (
                <StartScreenApprovalCard
                  key={item.key}
                  thread={item.thread}
                  agent={
                    (item.thread.session?.providerName &&
                      providerLabel(item.thread.session.providerName)) ||
                    "The agent"
                  }
                  fact={blockedFact(item)}
                  since={item.since}
                  renderCue={(since) => (
                    <AttentionCue verb={attentionCueVerb(item.kind)} since={since} />
                  )}
                  onOpen={() => openThread(item.thread)}
                  composerHasText={composerHasText}
                />
              ) : (
                <BlockedCard key={item.key} item={item} onOpen={openThread} />
              ),
            )}
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

/**
 * Board 1: up to two parked thoughts under the composer, then "N more". A chip
 * puts its thought in this composer and leaves Parked; "N more" opens the list.
 */
function ParkedChips({ chips, more }: { chips: ReadonlyArray<PromptStashEntry>; more: number }) {
  const { putInComposer, takeBackFromComposer } = useParkedActions();
  return (
    <section aria-label="Parked" className="-mt-3 flex flex-wrap items-center gap-1.5">
      <h3 className={LIST_HEADING_CLASS}>Parked</h3>
      {chips.map((entry) => (
        <Tooltip key={entry.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Put in composer: ${entry.prompt}`}
                className={cn(PARKED_CHIP_CLASS, "max-w-62.5")}
                onClick={() => {
                  void putInComposer(entry.prompt, entry.projectKey).then((placed) => {
                    if (!placed) return;
                    const removed = removeParkedEntry(entry.id);
                    if (!removed) return;
                    // Undo puts the thought back in Parked and takes it out of the composer.
                    toastManager.add({
                      type: "success",
                      title: "Put in composer",
                      actionProps: {
                        children: "Undo",
                        onClick: () => {
                          usePromptStashStore.getState().restoreEntry(removed.entry, removed.index);
                          takeBackFromComposer(removed.entry.prompt);
                        },
                      },
                    });
                  });
                }}
              />
            }
          >
            <span className="truncate">{entry.prompt}</span>
          </TooltipTrigger>
          <TooltipPopup side="bottom" className="max-w-80">
            Put in composer: {entry.prompt}
          </TooltipPopup>
        </Tooltip>
      ))}
      {more > 0 ? (
        <button type="button" className={PARKED_CHIP_CLASS} onClick={openParkedList}>
          {more} more
        </button>
      ) : null}
    </section>
  );
}

const PARKED_CHIP_CLASS =
  "inline-flex h-6 cursor-pointer items-center rounded-md bg-secondary px-2 text-xs leading-4 font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

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
  const age = formatElapsedAge(startedAt, minuteToIso(nowMinute));
  if (age === "") return null;
  const label = age.startsWith("since ")
    ? age
    : `${age} · since ${formatShortTimestamp(startedAt, timestampFormat)}`;
  return <span className={TIME_CUE_CLASS}>{label}</span>;
}

const BLOCKED_ACTION = {
  approval: "Open thread",
  input: "Answer",
} as const;

/**
 * "Codex wants to run 1 command", "Claude asks 1 question: …": what a blocked
 * thread waits on, from its shell, so no row subscribes to thread detail.
 */
function blockedFact(item: AttentionItem): string {
  return (
    threadNotificationFact(
      item.thread,
      item.kind === "approval" ? "approval" : "input",
      providerLabel,
    ) ?? ""
  );
}

/**
 * One thread blocked on you, past the first approval (which expands with its
 * actions in StartScreenApprovalCard): its fact and a button into the thread.
 */
const BlockedCard = memo(function BlockedCard({
  item,
  onOpen,
}: {
  item: AttentionItem;
  onOpen: OpenThread;
}) {
  const kind = item.kind as keyof typeof BLOCKED_ACTION;
  const fact = blockedFact(item);
  return (
    <article className="flex flex-wrap items-center gap-2.5 rounded-xl border border-warning-foreground bg-card px-4 py-3">
      <span className="inline-flex w-4 shrink-0 justify-center">
        {kind === "approval" ? (
          <BlockedDiamond />
        ) : (
          <MessageCircleQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-0.5">
        <h4 className="truncate text-[13px] leading-[18px] font-medium text-foreground">
          {item.thread.title}
        </h4>
        {fact ? (
          <p className="truncate text-xs leading-4 text-muted-foreground">{asSentence(fact)}</p>
        ) : null}
      </div>
      <AttentionCue verb={attentionCueVerb(item.kind)} since={item.since} />
      <Button
        size="sm"
        variant="outline"
        className="sm:text-xs"
        aria-label={`${BLOCKED_ACTION[kind]}: ${item.thread.title}`}
        onClick={() => onOpen(item.thread)}
      >
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
      <Button
        size="sm"
        variant="ghost"
        className="sm:text-xs"
        aria-label={`${isPlan ? "Review plan" : "Review diff"}: ${item.thread.title}`}
        onClick={() => onOpen(item.thread, { diff: !isPlan })}
      >
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
  // Retrying and waiting on a usage limit are neutral, as in the sidebar; the caption names them.
  const markKind = runningThreadMarkKind(thread);
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
          className={cn(
            "mx-1 inline-flex w-2 shrink-0 justify-center",
            THREAD_STATUS_TONE_TEXT[THREAD_STATUS_MARKS[markKind].tone],
          )}
        >
          <ThreadStatusMarker kind={markKind} marker={THREAD_STATUS_MARKS[markKind].marker} />
        </span>
        <span className="min-w-0 shrink truncate text-[13px] leading-[18px] font-medium text-foreground">
          {thread.title}
        </span>
        {progress ? <PlanStepMeter progress={progress} /> : null}
        <span className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">
          {caption}
        </span>
        {row.startedAt ? <WorkingCue startedAt={row.startedAt} /> : null}
      </button>
    </li>
  );
});
