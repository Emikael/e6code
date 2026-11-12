/**
 * The now bar under the thread header (board 2, F5): what the agent is doing
 * and for how long, in one line. Working shows the plan meter or the current
 * action and the only seconds counter in the app; blocked says what is asked
 * and how long ago; failed gives the reason and Retry; done says how long it
 * worked and offers the diff.
 */
import { formatAttentionAge } from "@e6tools/client-runtime/state/thread-attention";
import { BellIcon, CircleAlertIcon, ListChecksIcon, MessageCircleQuestionIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { useThreadWatchStore } from "~/threadWatchStore";
import { formatDayAwareTimestamp, formatShortTimestamp } from "~/timestampFormat";
import { BlockedDiamond } from "../SidebarNeedsYou";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatAttentionCue } from "./DraftHeroFooter.logic";
import { PlanStepMeter } from "./PlanStepMeter";
import { doneSummary, formatNowBarElapsed, type NowBarState } from "./ThreadNowBar.logic";

const STATUS_CLASS = "inline-flex shrink-0 items-center gap-1.5 text-xs leading-4 font-medium";
const TEXT_CLASS = "min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-foreground";
const TIME_CUE_CLASS =
  "shrink-0 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground tabular-nums";

export const ThreadNowBar = memo(function ThreadNowBar({
  state,
  watchKey,
  onRetry,
  retryUnavailableReason = null,
  earlierTurns = null,
  onReviewDiff,
}: {
  state: NowBarState;
  /** `scopedThreadKey` of the open thread, for "Notify me when done". */
  watchKey: string;
  /** Sends the last request again; absent when it cannot be resent as it was. */
  onRetry: (() => void) | null;
  /** Why Retry cannot send right now (the provider is unavailable); the button stays, disabled. */
  retryUnavailableReason?: string | null;
  /** "Earlier turns: 4m, 12m, 2m", the elapsed time's tooltip; null before a turn finished. */
  earlierTurns?: string | null;
  /** Absent while the Next card under the timeline already offers Review diff. */
  onReviewDiff: (() => void) | null;
}) {
  if (state.kind === "hidden") return null;
  return (
    <div className="flex-none px-3 pt-3 sm:px-5">
      <div
        role="group"
        aria-label="Now"
        className={cn(
          "mx-auto flex min-h-[46px] w-full max-w-(--chat-max-width) items-center gap-3 rounded-xl border bg-surface-raised px-3 py-2",
          state.kind === "blocked" ? "border-warning-foreground" : "border-border",
        )}
      >
        {state.kind === "working" ? (
          <>
            <span
              className={cn(
                STATUS_CLASS,
                state.live ? "text-primary-text" : "text-muted-foreground",
              )}
            >
              {state.live ? (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full bg-primary ring-3 ring-primary-surface"
                />
              ) : (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full border-[1.5px] border-muted-foreground"
                />
              )}
              {state.status}
            </span>
            {state.progress ? <PlanStepMeter progress={state.progress} /> : null}
            <span className={TEXT_CLASS}>{state.text}</span>
            {state.startedAt ? (
              <ElapsedCue startedAt={state.startedAt} earlierTurns={earlierTurns} />
            ) : null}
            <WatchToggle watchKey={watchKey} />
          </>
        ) : state.kind === "blocked" ? (
          <>
            <span className={cn(STATUS_CLASS, "text-warning-foreground")}>
              {state.request === "approval" ? (
                <BlockedDiamond />
              ) : (
                <MessageCircleQuestionIcon aria-hidden className="size-3.5 shrink-0" />
              )}
              {state.request === "approval" ? "Needs approval" : "Needs your answer"}
            </span>
            <span className={TEXT_CLASS}>{state.text}</span>
            <AskedCue since={state.since} />
          </>
        ) : state.kind === "failed" ? (
          <>
            <span className={cn(STATUS_CLASS, "text-destructive-foreground")}>
              <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />
              Failed
            </span>
            {/* The reason can outrun the bar; the tooltip keeps it whole. */}
            <Tooltip>
              <TooltipTrigger render={<span className={TEXT_CLASS} />}>{state.text}</TooltipTrigger>
              <TooltipPopup side="bottom" className="max-w-96">
                {state.text}
              </TooltipPopup>
            </Tooltip>
            {onRetry && retryUnavailableReason ? (
              <Tooltip>
                <TooltipTrigger render={<span className="shrink-0" />}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="sm:text-xs"
                    disabled
                    aria-describedby="now-bar-retry-reason"
                  >
                    Retry
                  </Button>
                  <span id="now-bar-retry-reason" className="sr-only">
                    {retryUnavailableReason}
                  </span>
                </TooltipTrigger>
                <TooltipPopup side="bottom">{retryUnavailableReason}</TooltipPopup>
              </Tooltip>
            ) : onRetry ? (
              <Button size="sm" variant="outline" className="sm:text-xs" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <span className={cn(STATUS_CLASS, "text-muted-foreground")}>
              <ListChecksIcon aria-hidden className="size-3.5 shrink-0" />
              Ready to review
            </span>
            <DoneText workedFor={state.workedFor} finishedAt={state.finishedAt} />
            {state.hasChanges && onReviewDiff ? (
              <Button size="sm" variant="outline" className="sm:text-xs" onClick={onReviewDiff}>
                Review diff
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});

function DoneText({ workedFor, finishedAt }: { workedFor: string | null; finishedAt: string }) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return (
    <span className={cn(TEXT_CLASS, "tabular-nums")}>
      {doneSummary(workedFor, formatDayAwareTimestamp(finishedAt, timestampFormat))}
    </span>
  );
}

function readElapsed(startedAt: string) {
  return formatNowBarElapsed(startedAt, Date.now());
}

/**
 * "2m 10s · since 14:02". The seconds are the one ticking element in the app:
 * they are written through a ref, so the bar never re-renders per second, and
 * they hold a fixed width so nothing beside them shifts. The tick stops while
 * the page is hidden. Past a day the whole cue becomes "since Tue".
 */
function ElapsedCue({
  startedAt,
  earlierTurns,
}: {
  startedAt: string;
  earlierTurns: string | null;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const textRef = useRef<HTMLSpanElement>(null);
  const initial = readElapsed(startedAt);
  const [pastDay, setPastDay] = useState<string | null>(null);
  const day = pastDay ?? (initial !== null && "day" in initial ? initial.day : null);

  useEffect(() => {
    if (day !== null) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const update = () => {
      const reading = readElapsed(startedAt);
      if (reading === null) return;
      if ("day" in reading) {
        stop();
        setPastDay(reading.day);
        return;
      }
      if (textRef.current) textRef.current.textContent = reading.elapsed;
    };
    const stop = () => {
      if (id !== null) clearInterval(id);
      id = null;
    };
    const start = () => {
      if (id !== null || document.visibilityState === "hidden") return;
      update();
      id = setInterval(update, 1_000);
    };
    const onVisibilityChange = () => (document.visibilityState === "hidden" ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [day, startedAt]);

  if (initial === null) return null;
  const cue =
    day !== null ? (
      <>since {day}</>
    ) : (
      <>
        <span ref={textRef} className="inline-block min-w-[7ch] text-end">
          {"elapsed" in initial ? initial.elapsed : ""}
        </span>
        {` · since ${formatShortTimestamp(startedAt, timestampFormat)}`}
      </>
    );
  if (earlierTurns === null) return <span className={TIME_CUE_CLASS}>{cue}</span>;
  // How long earlier turns took, as facts; never an estimate of this one (decision 7).
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className={cn(
              TIME_CUE_CLASS,
              "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        }
      >
        {cue}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{earlierTurns}</TooltipPopup>
    </Tooltip>
  );
}

/** "asked 4m ago", on the shared minute clock. */
function AskedCue({ since }: { since: string }) {
  const nowMinute = useNowMinute();
  const cue = formatAttentionCue("asked", formatAttentionAge(since, `${nowMinute}:00.000Z`));
  return cue ? <span className={TIME_CUE_CLASS}>{cue}</span> : null;
}

/** "Notify me when done": watches this thread until its turn settles. */
function WatchToggle({ watchKey }: { watchKey: string }) {
  const watched = useThreadWatchStore((store) => Boolean(store.watched[watchKey]));
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={watched}
      className={cn(
        "sm:text-xs",
        // Board 2: pressed is the secondary fill, a primary-edge line and a foreground icon.
        watched &&
          "border-primary-edge bg-secondary text-foreground hover:bg-secondary [--control-icon-color:var(--foreground)]",
      )}
      onClick={() => useThreadWatchStore.getState().setWatched(watchKey, !watched)}
    >
      <BellIcon aria-hidden className="size-3.5" />
      {/* Phones keep the bell alone; the label stays the accessible name. */}
      <span className="sr-only sm:not-sr-only">Notify me when done</span>
    </Button>
  );
}
