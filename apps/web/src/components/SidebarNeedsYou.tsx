/**
 * The sidebar's Needs you section: blocked threads, then work to review,
 * above the thread list. Each thread keeps its normal row below; this is a
 * derived view, not a move. Rows are plain buttons outside the list's
 * keyboard tree and drag context, so they never take part in reordering.
 */
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import {
  formatAttentionAge,
  type ThreadAttention,
  type ThreadAttentionItem,
  type ThreadAttentionKind,
} from "@e6tools/client-runtime/state/thread-attention";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";
import { memo, useCallback, useState, type ReactNode } from "react";

import { useNowMinute } from "../hooks/useNowMinute";
import { useClientSettings } from "../hooks/useSettings";
import { cn } from "~/lib/utils";

type Item = ThreadAttentionItem<EnvironmentThreadShell>;

/** Blocked on you (approval): a rotated square in `warning-foreground`. */
export function BlockedDiamond({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rotate-45 rounded-[1px] bg-warning-foreground", className)}
    />
  );
}

/**
 * Whole minutes since `since`, on the shared minute clock. Only this span
 * re-renders each minute. Hidden when "Elapsed time in the thread list" is off.
 */
export function SidebarElapsedTime({
  since,
  prefix,
  className,
}: {
  since: string;
  prefix?: string;
  className?: string;
}) {
  const enabled = useClientSettings((settings) => settings.sidebarElapsedTimeEnabled);
  const nowMinute = useNowMinute();
  if (!enabled) return null;
  void nowMinute;
  const label = formatAttentionAge(since, new Date().toISOString());
  if (label === "") return null;
  return (
    <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", className)}>
      {prefix}
      {label}
    </span>
  );
}

const BLOCKED_LABEL: Record<"approval" | "input" | "failed", string> = {
  approval: "Needs approval",
  input: "Needs your answer",
  failed: "Failed",
};

function BlockedGlyph({ kind }: { kind: ThreadAttentionKind }) {
  if (kind === "approval") return <BlockedDiamond />;
  if (kind === "input") {
    return (
      <MessageCircleQuestionIcon
        aria-hidden
        className="size-3.5 shrink-0 text-warning-foreground"
      />
    );
  }
  return <CircleAlertIcon aria-hidden className="size-3.5 shrink-0 text-destructive-foreground" />;
}

/** Board 2: the selected row gets a 1px `input` edge over the card shadow, not a fill alone. */
const SELECTED_ROW = "bg-sidebar-row-active shadow-xs ring-1 ring-input";

const ROW_FOCUS =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const BlockedRow = memo(function BlockedRow(props: {
  item: Item;
  isActive: boolean;
  onOpen: (item: Item) => void;
}) {
  const { item } = props;
  const label = BLOCKED_LABEL[item.kind as "approval" | "input" | "failed"];
  return (
    <li>
      <button
        type="button"
        onClick={() => props.onOpen(item)}
        aria-current={props.isActive ? "page" : undefined}
        className={cn(
          "flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-[7px] text-left",
          ROW_FOCUS,
          props.isActive ? SELECTED_ROW : "hover:bg-sidebar-row-hover",
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] font-medium text-sidebar-foreground">
          <span className="inline-flex w-3.5 shrink-0 justify-center">
            <BlockedGlyph kind={item.kind} />
          </span>
          <span className="min-w-0 truncate">{item.thread.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-sidebar-muted-foreground">
          <span
            className={cn(
              "shrink-0 font-medium",
              item.kind === "failed" ? "text-destructive-foreground" : "text-warning-foreground",
            )}
          >
            {label}
          </span>
          <SidebarElapsedTime since={item.since} prefix="· " />
        </span>
      </button>
    </li>
  );
});

const ReviewRow = memo(function ReviewRow(props: {
  item: Item;
  isActive: boolean;
  onOpen: (item: Item) => void;
}) {
  const { item } = props;
  const isPlan = item.kind === "plan";
  return (
    <li>
      <button
        type="button"
        onClick={() => props.onOpen(item)}
        aria-current={props.isActive ? "page" : undefined}
        className={cn(
          "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-[13px] leading-[18px] font-medium text-sidebar-foreground",
          ROW_FOCUS,
          props.isActive ? SELECTED_ROW : "hover:bg-sidebar-row-hover",
        )}
      >
        {isPlan ? (
          <ListChecksIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        ) : (
          <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">{item.thread.title}</span>
        <span className="shrink-0 text-xs font-normal text-sidebar-muted-foreground">
          {isPlan ? "Plan ready" : "Done"}
        </span>
      </button>
    </li>
  );
});

function SectionLabel(props: { children: ReactNode; className?: string; level?: "h2" | "h3" }) {
  const Heading = props.level ?? "h2";
  return (
    <Heading
      className={cn(
        "flex items-center gap-2 px-2.5 pt-2 pb-1 text-[11px] leading-[14px] font-medium tracking-[0.01em] text-sidebar-muted-foreground",
        props.className,
      )}
    >
      {props.children}
    </Heading>
  );
}

/**
 * While the pointer is over the section, rows keep the order they had when
 * it arrived, so a row never slides out from under a click. Thread data
 * stays live; membership and order catch up when the pointer leaves.
 */
function useHeldAttention(
  attention: ThreadAttention<EnvironmentThreadShell>,
  threadsByKey: ReadonlyMap<string, EnvironmentThreadShell>,
) {
  const [held, setHeld] = useState<ThreadAttention<EnvironmentThreadShell> | null>(null);
  const refresh = (items: ReadonlyArray<Item>) =>
    items.map((item) => {
      const thread = threadsByKey.get(item.key);
      return thread && thread !== item.thread ? { ...item, thread } : item;
    });
  const shown = held
    ? {
        ...held,
        blocked: refresh(held.blocked),
        earlier: refresh(held.earlier),
        review: refresh(held.review),
      }
    : attention;
  return {
    shown,
    hold: () => setHeld(attention),
    release: () => setHeld(null),
  };
}

export function SidebarNeedsYou(props: {
  attention: ThreadAttention<EnvironmentThreadShell>;
  threadsByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  activeThreadKey: string | null;
  onOpen: (thread: EnvironmentThreadShell) => void;
  /** Offers snooze times for the snoozable threads in Earlier; null when none can be. */
  onSnoozeEarlier: ((position: { x: number; y: number }) => void) | null;
  /** How many Earlier threads "Snooze" acts on: failed ones; approvals and questions cannot be. */
  snoozableEarlierCount: number;
}) {
  const { shown, hold, release } = useHeldAttention(props.attention, props.threadsByKey);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const { blockedCount } = props.attention;
  const { onOpen } = props;
  const open = useCallback((item: Item) => onOpen(item.thread), [onOpen]);
  if (shown.blocked.length === 0 && shown.earlier.length === 0 && shown.review.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Needs you"
      data-testid="sidebar-needs-you"
      onPointerEnter={hold}
      onPointerLeave={release}
      className="mx-0.5 mb-1 flex flex-col gap-0.5 border-b border-sidebar-border pb-2"
    >
      <SectionLabel>
        <span className="flex-1">Needs you</span>
        {blockedCount > 0 ? (
          <span className="inline-flex h-5 items-center rounded-sm bg-warning-surface px-1.5 text-[11px] font-medium text-warning-foreground tabular-nums">
            {blockedCount}
            <span className="sr-only"> blocked</span>
          </span>
        ) : null}
      </SectionLabel>
      {shown.blocked.length > 0 ? (
        <ul className="flex flex-col gap-px">
          {shown.blocked.map((item) => (
            <BlockedRow
              key={item.key}
              item={item}
              isActive={item.key === props.activeThreadKey}
              onOpen={open}
            />
          ))}
        </ul>
      ) : null}
      {shown.earlier.length > 0 ? (
        <div className="flex flex-col gap-px">
          <div className="group/earlier flex h-8 items-center gap-1 rounded-lg pr-1">
            <h3 className="min-w-0 flex-1">
              <button
                type="button"
                aria-expanded={earlierOpen}
                onClick={() => setEarlierOpen((value) => !value)}
                className={cn(
                  "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-row-hover",
                  ROW_FOCUS,
                )}
              >
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-sidebar-muted-foreground",
                    earlierOpen && "rotate-90",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">Earlier</span>
                <span className="shrink-0 text-xs font-normal text-sidebar-muted-foreground tabular-nums">
                  {shown.earlier.length}
                  <span className="sr-only"> blocked for over a day</span>
                </span>
              </button>
            </h3>
            {props.onSnoozeEarlier ? (
              <button
                type="button"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  props.onSnoozeEarlier?.({ x: rect.left, y: rect.bottom + 4 });
                }}
                className={cn(
                  "h-6 shrink-0 cursor-pointer rounded-md px-2 text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                  ROW_FOCUS,
                )}
              >
                Snooze {props.snoozableEarlierCount} failed
              </button>
            ) : null}
          </div>
          {earlierOpen ? (
            <ul className="flex flex-col gap-px">
              {shown.earlier.map((item) => (
                <BlockedRow
                  key={item.key}
                  item={item}
                  isActive={item.key === props.activeThreadKey}
                  onOpen={open}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {shown.review.length > 0 ? (
        <>
          <SectionLabel level="h3" className="pt-1">
            To review
          </SectionLabel>
          <ul className="flex flex-col gap-px">
            {shown.review.map((item) => (
              <ReviewRow
                key={item.key}
                item={item}
                isActive={item.key === props.activeThreadKey}
                onOpen={open}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
