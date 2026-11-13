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
import { memo, useCallback, useRef, useState, type FocusEvent, type ReactNode } from "react";

import { useNowMinute } from "../hooks/useNowMinute";
import { useClientSettings } from "../hooks/useSettings";
import { cn } from "~/lib/utils";

type Item = ThreadAttentionItem<EnvironmentThreadShell>;

/** Blocked on you (approval): a rotated square in `warning-foreground`. */
export function BlockedDiamond({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rotate-45 rounded-[2px] bg-warning-foreground", className)}
    />
  );
}

/**
 * A compact time after a status word, as board 1 draws it: a sans "·", then
 * the time in mono 11px (`t-meta`), 6px apart. Muted, whatever the status hue.
 */
export function SidebarMetaTime({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-sidebar-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className="font-normal">
        ·
      </span>
      <span className="font-mono text-[11px] font-normal tabular-nums">{label}</span>
    </span>
  );
}

/**
 * Whole minutes since `since`, on the shared minute clock, after a "·". Only
 * this span re-renders each minute. Hidden when "Elapsed time in the thread
 * list" is off.
 */
export function SidebarElapsedTime({ since, className }: { since: string; className?: string }) {
  const enabled = useClientSettings((settings) => settings.sidebarElapsedTimeEnabled);
  const nowMinute = useNowMinute();
  if (!enabled) return null;
  void nowMinute;
  const label = formatAttentionAge(since, new Date().toISOString());
  if (label === "") return null;
  return <SidebarMetaTime label={label} {...(className ? { className } : {})} />;
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

/**
 * The open thread's row, here and in the project groups (board 2,
 * `.thread--selected`): the selected surface, a 1px `input` hairline and the
 * card shadow, not a fill alone.
 */
export const SIDEBAR_SELECTED_ROW_CLASS =
  "bg-sidebar-row-selected shadow-xs ring-1 ring-input dark:shadow-[0_1px_2px_0_rgb(0_0_0/0.4)]";

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
          props.isActive ? SIDEBAR_SELECTED_ROW_CLASS : "hover:bg-sidebar-row-hover",
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] font-medium text-sidebar-foreground">
          <BlockedGlyph kind={item.kind} />
          <span className="min-w-0 truncate">{item.thread.title}</span>
        </span>
        {/* Board 1: the meta line sits 16px in, under a diamond row's title. */}
        <span className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-sidebar-muted-foreground">
          <span
            className={cn(
              "shrink-0 font-medium",
              item.kind === "failed" ? "text-destructive-foreground" : "text-warning-foreground",
            )}
          >
            {label}
          </span>
          <SidebarElapsedTime since={item.since} />
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
          props.isActive ? SIDEBAR_SELECTED_ROW_CLASS : "hover:bg-sidebar-row-hover",
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
 * While the pointer is over the section, or keyboard focus is inside it, rows
 * keep the order they had when it arrived, so a row never slides out from
 * under a click or a keypress. Thread data stays live; membership and order
 * catch up when both have left.
 */
function useHeldAttention(
  attention: ThreadAttention<EnvironmentThreadShell>,
  threadsByKey: ReadonlyMap<string, EnvironmentThreadShell>,
) {
  const [held, setHeld] = useState<ThreadAttention<EnvironmentThreadShell> | null>(null);
  const holders = useRef({ pointer: false, focus: false });
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
  const set = (holder: "pointer" | "focus", holding: boolean) => {
    holders.current[holder] = holding;
    const anyHolding = holders.current.pointer || holders.current.focus;
    setHeld((current) => (anyHolding ? (current ?? attention) : null));
  };
  return {
    shown,
    sectionProps: {
      onPointerEnter: () => set("pointer", true),
      onPointerLeave: () => set("pointer", false),
      // Keyboard focus only: a clicked row keeps focus after it opens the thread.
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.target.matches(":focus-visible")) set("focus", true);
      },
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          set("focus", false);
        }
      },
    },
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
  const { shown, sectionProps } = useHeldAttention(props.attention, props.threadsByKey);
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
      {...sectionProps}
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
        <ul className="flex flex-col gap-0.5">
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
        <div className="flex flex-col gap-0.5">
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
            <ul className="flex flex-col gap-0.5">
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
          <ul className="flex flex-col gap-0.5">
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
