import {
  legacyThreadPullRequestKey,
  threadPullRequestKeyOf,
  threadPullRequestSearchTerms,
  threadPullRequestUpdatedAt,
  visibleThreadPullRequests,
} from "@e6tools/shared/threadPullRequests";
import * as React from "react";
import { defaultAnimateLayoutChanges, type AnimateLayoutChanges } from "@dnd-kit/sortable";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@e6tools/client-runtime/state/runtime";
import { threadSearchMatchKey } from "@e6tools/client-runtime/state/thread-search";
import type { ContextMenuItem, EnvironmentId, ThreadId } from "@e6tools/contracts";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@e6tools/contracts/settings";
import type { AsyncResult } from "effect/unstable/reactivity";
import { planPinnedReorder } from "@e6tools/client-runtime/state/thread-sort";
import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@e6tools/client-runtime/state/thread-settled";
import {
  getThreadSortTimestamp,
  resolveSettledThreadTimestamp,
  sortThreads,
  toSortableTimestamp,
  type SettledThreadTimestampInput,
  type ThreadSortInput,
} from "../lib/threadSort";
import type { SidebarThreadSummary, Thread } from "../types";
import type { SwitchboardStatus } from "./sidebar/primitives/status";
import { cn } from "../lib/utils";
import { isLatestTurnSettled } from "../session-logic";

export function shouldNavigateAfterThreadPark(input: {
  readonly threadKey: string;
  readonly currentThreadKey: string | null;
  readonly action: "settle" | "snooze";
  readonly now: string;
  readonly thread: (ThreadSnoozeShell & Pick<SidebarThreadSummary, "settledOverride">) | null;
}): boolean {
  return (
    input.threadKey === input.currentThreadKey &&
    input.thread !== null &&
    (input.action === "settle"
      ? input.thread.settledOverride === "settled"
      : effectiveSnoozed(input.thread, { now: input.now }))
  );
}

const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 200;
// Visible sidebar rows are prewarmed into the thread-detail cache so opening a
// nearby thread usually reuses an already-hot subscription. Each prewarmed
// thread holds a live, fully hydrated detail subscription (all messages and
// activities, growing as agents work) for as long as the row stays visible,
// so this limit is a direct renderer-heap and server-load multiplier — keep
// it small; cold opens still render instantly from the cached snapshot.
const SIDEBAR_THREAD_PREWARM_LIMIT = 3;
// A small buffer keeps the next few rows warm without leasing every row that
// content-visibility leaves mounted below the scroll viewport.
const SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX = 160;

export function useSidebarRowSubscriptionLease(isActive: boolean): {
  readonly leaseLiveStatus: boolean;
  readonly rowRef: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
} {
  const [row, setRow] = React.useState<HTMLElement | null>(null);
  const [isNearViewport, setIsNearViewport] = React.useState(isActive);

  React.useEffect(() => {
    if (isActive) {
      setIsNearViewport(true);
      return;
    }
    if (row === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const scrollRoot = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(entry?.isIntersecting === true),
      {
        root: scrollRoot,
        rootMargin: `${SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX}px 0px`,
      },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [isActive, row]);

  return {
    leaseLiveStatus: isActive || isNearViewport,
    rowRef: setRow,
  };
}

// A row keeps the last live value it rendered so a released lease never
// blanks its badge. The value is bound to `key`, so a different worktree or
// linked pull request cannot reuse the previous one.
export function useRetainedValue<T>(key: string | null, value: T | null): T | null {
  const retained = React.useRef<{ readonly key: string; readonly value: T } | null>(null);
  if (key !== null && value !== null) {
    retained.current = { key, value };
  }
  if (value !== null) return value;
  return key !== null && retained.current?.key === key ? retained.current.value : null;
}

// Sidebar.motion handles ordinary section changes. Sortable transforms own
// dragging; replaying their committed DOM order would animate the drop twice.
export const animateSidebarLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting ? defaultAnimateLayoutChanges(args) : false;

// Rows and section markers share one sortable list. The separators resolve
// the lifecycle action; Sidebar.drag previews the resulting layout. Pinned
// and active threads keep the dragged position; settled threads use time
// order. Snoozed rows can leave the shelf, but dropping into it is not
// supported because snoozing requires a wake time.

export type SidebarSection = "pinned" | "active" | "snoozed" | "settled";

export function sidebarBranchLaneKey(
  thread: Pick<SidebarThreadSummary, "environmentId" | "projectId" | "branch" | "worktreePath">,
): string {
  const identity = thread.worktreePath
    ? `wt:${thread.worktreePath}`
    : thread.branch
      ? `br:${thread.branch}`
      : "none";
  return `${thread.environmentId}:${thread.projectId}:${identity}`;
}

export function groupSidebarBranchLanes(activeThreads: readonly SidebarThreadSummary[]) {
  const lanes = new Map<
    string,
    {
      lane: {
        key: string;
        environmentId: EnvironmentId;
        projectId: SidebarThreadSummary["projectId"];
        branch: string | null;
        worktreePath: string | null;
        threads: SidebarThreadSummary[];
      };
      live: boolean;
      timestamp: number;
    }
  >();
  for (const thread of activeThreads) {
    const key = sidebarBranchLaneKey(thread);
    let entry = lanes.get(key);
    if (!entry) {
      entry = {
        lane: {
          key,
          environmentId: thread.environmentId,
          projectId: thread.projectId,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          threads: [],
        },
        live: false,
        timestamp: Number.NEGATIVE_INFINITY,
      };
      lanes.set(key, entry);
    }
    entry.lane.threads.push(thread);
    const status = resolveSidebarThreadStatus(thread);
    entry.live ||= status === "working" || status === "monitoring";
    entry.timestamp = Math.max(entry.timestamp, getThreadSortTimestamp(thread, "updated_at"));
  }
  return (
    [...lanes.values()]
      // Equal or unparseable activity (−∞ − −∞ is NaN) falls back to the lane key.
      .sort(
        (a, b) =>
          Number(b.live) - Number(a.live) ||
          b.timestamp - a.timestamp ||
          a.lane.key.localeCompare(b.lane.key),
      )
      .map(({ lane }) => lane)
  );
}

/** Active rows as drawn: lane by lane (branch lanes or Status sections),
 * by project group when grouped, otherwise in their sorted order. A collapsed
 * lane draws no rows; only a key mapped to `true` collapses, so stale keys
 * from lanes that no longer exist collapse nothing. */
export function sidebarRenderedActiveThreads<T>(input: {
  readonly branchLanes: readonly { readonly key?: string; readonly threads: readonly T[] }[] | null;
  readonly projectGroups: readonly { readonly rendered: readonly T[] }[] | null;
  readonly active: readonly T[];
  readonly collapsedLanes?: Readonly<Record<string, boolean>>;
}): readonly T[] {
  if (input.branchLanes)
    return input.branchLanes.flatMap((lane) =>
      lane.key !== undefined && input.collapsedLanes?.[lane.key] === true ? [] : lane.threads,
    );
  return input.projectGroups?.flatMap((group) => group.rendered) ?? input.active;
}

/** Every rendered row in drawing order. The ⌘1–9 numbering and Shift-click
 * range select read this order; next/previous reads it with collapsed lanes'
 * rows included. */
export function sidebarVisualThreadOrder<T>(input: {
  readonly pinned: readonly T[];
  readonly active: readonly T[];
  readonly snoozed: readonly T[];
  readonly settled: readonly T[];
}): T[] {
  return [...input.pinned, ...input.active, ...input.snoozed, ...input.settled];
}

const SIDEBAR_BRANCH_LANE_PREFIX = "sidebar-branch-lane-";

export function sidebarBranchLaneId(key: string): string {
  return `${SIDEBAR_BRANCH_LANE_PREFIX}${key}`;
}

/** The lane a wrapper droppable id names. List items win: a scoped thread key
    may itself start with the lane prefix. */
function sidebarBranchLaneKeyOfId(items: readonly SidebarListItem[], id: string): string | null {
  if (!id.startsWith(SIDEBAR_BRANCH_LANE_PREFIX)) return null;
  if (items.some((item) => sidebarListItemId(item) === id)) return null;
  return id.slice(SIDEBAR_BRANCH_LANE_PREFIX.length);
}

/** Sortable ids: thread rows use their scoped key; structural items use a
    colon-free prefix: scoped thread keys always contain a colon. */
const SIDEBAR_MARKER_PREFIX = "sidebar-marker-";

export type SidebarListMarker =
  /** The top boundary is also a landing target when there are no pins. */
  | "pinned-header"
  /** Stand-in rows so an empty section has somewhere for the gap to open. */
  | "active-placeholder"
  | "settled-placeholder"
  /** The boundary between pinned and active rows. */
  | "pinned-divider"
  | "snoozed-header"
  | "settled-header";

export function sidebarMarkerId(marker: SidebarListMarker): string {
  return `${SIDEBAR_MARKER_PREFIX}${marker}`;
}

export type SidebarListItem =
  | { readonly kind: "thread"; readonly key: string; readonly section: SidebarSection }
  | { readonly kind: "marker"; readonly marker: SidebarListMarker };

export function sidebarListItemId(item: SidebarListItem): string {
  return item.kind === "thread" ? item.key : sidebarMarkerId(item.marker);
}

/** The section a slot belongs to, read off the markers around it: from
    the top down, everything before the pinned divider is pinned, then the
    inbox until the snoozed header, the shelf until the settled header,
    then settled. */
function sectionAtSidebarSlot(items: readonly SidebarListItem[], index: number): SidebarSection {
  let section: SidebarSection = "pinned";
  for (let i = 0; i < index && i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind !== "marker") continue;
    if (item.marker === "pinned-divider") section = "active";
    else if (item.marker === "snoozed-header") section = "snoozed";
    else if (item.marker === "settled-header") section = "settled";
  }
  return section;
}

/** Resolve the destination section and manual order from an arrayMove across
 * the separators. The snoozed shelf is never a destination. */
export type SidebarDropTarget = {
  readonly section: "pinned" | "active" | "settled";
  readonly pinnedOrder: readonly string[];
  readonly activeOrder: readonly string[];
};

export function resolveSidebarDropTarget(
  items: readonly SidebarListItem[],
  activeKey: string,
  overId: string,
): SidebarDropTarget | null {
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === activeKey);
  const overIndex = items.findIndex((item) => sidebarListItemId(item) === overId);
  if (activeIndex === -1 || overIndex === -1 || items[activeIndex]?.kind !== "thread") return null;
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, items[activeIndex]!);
  const section = sectionAtSidebarSlot(moved, overIndex);
  if (section === "snoozed") return null;
  const pinnedOrder: string[] = [];
  const activeOrder: string[] = [];
  let currentSection: SidebarSection = "pinned";
  for (const item of moved) {
    if (item.kind === "marker") {
      if (item.marker === "pinned-divider") currentSection = "active";
      else if (item.marker === "snoozed-header" || item.marker === "settled-header") break;
    } else if (currentSection === "pinned") pinnedOrder.push(item.key);
    else activeOrder.push(item.key);
  }
  return { section, pinnedOrder, activeOrder };
}

/** The lane a drop lands in: a lane wrapper's own key, or the lane of the
 * active row under the pointer. */
function sidebarDropLaneKey(
  items: readonly SidebarListItem[],
  overId: string,
  laneKeyByThreadKey: ReadonlyMap<string, string>,
): string | null {
  const over = items.find((item) => sidebarListItemId(item) === overId);
  if (over === undefined) return sidebarBranchLaneKeyOfId(items, overId);
  return over.kind === "thread" && over.section === "active"
    ? (laneKeyByThreadKey.get(over.key) ?? null)
    : null;
}

/** Branch rows keep their lane, while manual keys still describe the global
 * active order. Locked lanes (Status sections) take no reorder at all: their
 * order and membership come from status. A snoozed or settled row may still
 * leave its shelf into one, since only its lifecycle changes. */
export function resolveSidebarBranchDropTarget(input: {
  readonly items: readonly SidebarListItem[];
  readonly activeKey: string;
  readonly overId: string;
  readonly laneKeyByThreadKey: ReadonlyMap<string, string>;
  readonly activeOrder: readonly string[];
  readonly lockedLaneKeys?: ReadonlySet<string>;
}): SidebarDropTarget | null {
  const { items, activeKey, overId, laneKeyByThreadKey, activeOrder } = input;
  const source = items.find((item) => item.kind === "thread" && item.key === activeKey);
  if (source?.kind !== "thread") return null;
  const sourceLane = laneKeyByThreadKey.get(activeKey);
  const over = items.find((item) => sidebarListItemId(item) === overId);
  const headerLane = over ? null : sidebarBranchLaneKeyOfId(items, overId);
  if (
    (over?.kind === "thread" && over.section === "snoozed") ||
    overId === sidebarMarkerId("snoozed-header")
  )
    return null;
  const dropLane = sidebarDropLaneKey(items, overId, laneKeyByThreadKey);
  if (dropLane !== null && input.lockedLaneKeys?.has(dropLane)) {
    if (source.section !== "snoozed" && source.section !== "settled") return null;
    return {
      section: "active",
      pinnedOrder: items.flatMap((item) =>
        item.kind === "thread" && item.section === "pinned" ? [item.key] : [],
      ),
      activeOrder: [activeKey, ...activeOrder.filter((key) => key !== activeKey)],
    };
  }
  const laneRows = items.flatMap((item) =>
    item.kind === "thread" && item.section === "active" ? [item] : [],
  );
  let target: SidebarDropTarget | null;
  if (headerLane !== null) {
    const firstIndex = laneRows.findIndex(
      (item) => laneKeyByThreadKey.get(item.key) === headerLane,
    );
    if (firstIndex < 0 || sourceLane !== headerLane) return null;
    const order = laneRows.map((item) => item.key).filter((key) => key !== activeKey);
    order.splice(firstIndex, 0, activeKey);
    target = {
      section: "active",
      pinnedOrder: items.flatMap((item) =>
        item.kind === "thread" && item.section === "pinned" && item.key !== activeKey
          ? [item.key]
          : [],
      ),
      activeOrder: order,
    };
  } else {
    target = resolveSidebarDropTarget(items, activeKey, overId);
  }
  if (!target) return null;
  if (target.section !== "active") {
    return { ...target, activeOrder: activeOrder.filter((key) => key !== activeKey) };
  }
  const destinationLane =
    headerLane ?? (over?.kind === "thread" ? laneKeyByThreadKey.get(over.key) : sourceLane);
  if (!sourceLane || sourceLane !== destinationLane) return null;
  const laneOrder = target.activeOrder.filter((key) => laneKeyByThreadKey.get(key) === sourceLane);
  const originalLaneOrder = activeOrder.filter((key) => laneKeyByThreadKey.get(key) === sourceLane);
  if (
    laneOrder.length === originalLaneOrder.length &&
    laneOrder.every((key, index) => key === originalLaneOrder[index])
  ) {
    return { ...target, activeOrder };
  }
  const index = laneOrder.indexOf(activeKey);
  if (index < 0) return null;
  const order = activeOrder.filter((key) => key !== activeKey);
  const previousKey = laneOrder[index - 1];
  const nextKey = laneOrder[index + 1];
  const previousIndex = originalLaneOrder.indexOf(activeKey);
  const movingDown = previousIndex >= 0 && index > previousIndex;
  const insertionIndex =
    movingDown && previousKey !== undefined
      ? order.indexOf(previousKey) + 1
      : nextKey !== undefined
        ? order.indexOf(nextKey)
        : previousKey !== undefined
          ? order.indexOf(previousKey) + 1
          : order.length;
  order.splice(insertionIndex, 0, activeKey);
  return { ...target, activeOrder: order };
}

export interface SidebarBranchDragFeedback {
  readonly target: SidebarDropTarget | null;
  /** The active lane under the pointer. Pinned, snoozed and settled rows
      belong to their shelf, not to their branch lane. */
  readonly overLaneKey: string | null;
  /** Set when that lane refuses the drop because it is another branch. */
  readonly rejectedLaneKey: string | null;
}

export function resolveSidebarBranchDragFeedback(input: {
  readonly items: readonly SidebarListItem[];
  readonly activeKey: string;
  readonly overId: string | null;
  readonly laneKeyByThreadKey: ReadonlyMap<string, string>;
  readonly activeOrder: readonly string[];
  readonly lockedLaneKeys?: ReadonlySet<string>;
}): SidebarBranchDragFeedback {
  const { items, activeKey, overId, laneKeyByThreadKey } = input;
  if (overId === null) return { target: null, overLaneKey: null, rejectedLaneKey: null };
  const target = resolveSidebarBranchDropTarget({ ...input, overId });
  const overLaneKey = sidebarDropLaneKey(items, overId, laneKeyByThreadKey);
  // A locked lane refuses even the row's own lane, but the row's own slot is
  // where every refused target falls back to, so it stays quiet.
  const rejectedLaneKey =
    target === null &&
    overLaneKey !== null &&
    (input.lockedLaneKeys?.has(overLaneKey)
      ? overId !== activeKey
      : overLaneKey !== laneKeyByThreadKey.get(activeKey))
      ? overLaneKey
      : null;
  return { target, overLaneKey, rejectedLaneKey };
}

export type SidebarBranchDragVerb =
  | "Move"
  | "Pin"
  | "Settle"
  | "Wake"
  | "Can't move here"
  | "Sorted by status";

/** The drag chip's badge; null over no drop target and over the row's own
 * slot, which is also where targets the server refuses fall back to. A
 * refused lane says why: another branch, or a section sorted by status. */
export function resolveSidebarBranchDragVerb(input: {
  readonly sourceSection: SidebarSection;
  readonly targetSection: SidebarSection | null;
  readonly rejected: false | "branch" | "status";
  readonly overSelf: boolean;
}): SidebarBranchDragVerb | null {
  if (input.rejected === "status") return "Sorted by status";
  if (input.rejected === "branch") return "Can't move here";
  if (input.overSelf || input.targetSection === null) return null;
  if (input.sourceSection === "snoozed" && input.targetSection === "active") return "Wake";
  if (input.targetSection === "pinned" && input.sourceSection !== "pinned") return "Pin";
  if (input.targetSection === "settled" && input.sourceSection !== "settled") return "Settle";
  return "Move";
}

const SIDEBAR_BRANCH_DROP_RESULTS = {
  Move: "Moved thread",
  Pin: "Pinned thread",
  Settle: "Settled thread",
  Wake: "Woke thread",
} as const;

/** What the drag live region says while a branch-mode drag is `over` a target
 * and when it `end`s, given the chip's verb. Undefined keeps it quiet: a row
 * that has not left its own slot since pick-up has nothing to report. */
export function resolveSidebarBranchDragAnnouncement(input: {
  readonly phase: "over" | "end";
  readonly verb: SidebarBranchDragVerb | null;
  /** False while the pointer is over no drop target at all. */
  readonly hasTarget: boolean;
  readonly overSelf: boolean;
  /** Whether the drag has been over another target since it started. */
  readonly leftOwnSlot: boolean;
  /** The lane a rejected drop was aimed at: its branch (null is the "No
   * branch" lane), or the Status section's name. */
  readonly rejectedBranch: string | null;
}): string | undefined {
  const { verb } = input;
  if (input.phase === "end") {
    if (verb === "Can't move here") return "Can't move here. Thread returned.";
    if (verb === "Sorted by status") return "Sorted by status. Thread returned.";
    return verb === null ? "Thread returned" : SIDEBAR_BRANCH_DROP_RESULTS[verb];
  }
  if (!input.hasTarget) return "No drop target";
  if (verb === "Can't move here") {
    return `Can't move to ${input.rejectedBranch ?? "No branch"}. Branch comes from the thread's worktree.`;
  }
  if (verb === "Sorted by status") {
    return `Can't reorder in ${input.rejectedBranch ?? "this section"}. Sorted by status.`;
  }
  if (verb === "Pin") return "Pin thread: drop to pin";
  if (verb !== null) return `${verb} thread`;
  if (!input.overSelf) return "Can't drop here";
  return input.leftOwnSlot ? "Thread is back in its place" : undefined;
}

export type SidebarThreadDropPlan =
  | { readonly kind: "none" }
  /** Within the pinned block: the existing key writes. */
  | {
      readonly kind: "reorder-pinned";
      readonly order: readonly string[];
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
    }
  /** From another section into the pinned block. Fresh pins take `orderKey`
      on the pin command. `extraAssignments` land afterward, including the
      moved row when it was already pinned beneath a snooze. */
  | {
      readonly kind: "pin";
      readonly order: readonly string[];
      readonly orderKey: string | undefined;
      readonly extraAssignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
    }
  | {
      readonly kind: "move-active";
      readonly order: readonly string[];
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
      readonly unpin: boolean;
      readonly unsettle: boolean;
      readonly unsnooze: boolean;
    }
  | { readonly kind: "settle" };

/** What dropping in `to` does to a thread lifted from `from`, for the badge
    on the lifted row. Null while reordering inside one section and for the
    snoozed shelf, which cannot be a drop target. */
export type SidebarDropVerb = "pin" | "unpin" | "settle" | "unsettle" | "wake";

export function resolveSidebarDropVerb(
  from: SidebarSection,
  to: SidebarSection | null,
): SidebarDropVerb | null {
  if (to === null || to === from || to === "snoozed") return null;
  if (to === "pinned") return "pin";
  if (to === "settled") return "settle";
  if (from === "pinned") return "unpin";
  if (from === "settled") return "unsettle";
  return "wake";
}

export function planSidebarThreadDrop(input: {
  readonly activeKey: string;
  readonly activeSection: SidebarSection;
  /** Snoozed threads can retain pinning and settlement beneath the shelf. */
  readonly activePinned?: boolean;
  readonly activeSettled?: boolean;
  readonly supportsSettlement?: boolean;
  readonly target: SidebarDropTarget;
  /** All pinned keys in displayed order before the drop. */
  readonly pinnedOrder: readonly string[];
  readonly pinnedKeysById: ReadonlyMap<string, string | null | undefined>;
  readonly reorderableKeys?: ReadonlySet<string>;
  readonly activeOrder: readonly string[];
  readonly activeKeysById: ReadonlyMap<string, string | null | undefined>;
  readonly activeReorderableKeys?: ReadonlySet<string>;
}): SidebarThreadDropPlan {
  const {
    activeKey,
    activeSection,
    activePinned = activeSection === "pinned",
    activeSettled = activeSection === "settled",
    target,
    pinnedOrder,
    pinnedKeysById,
    reorderableKeys,
    activeOrder,
    activeKeysById,
    activeReorderableKeys,
  } = input;
  if (input.supportsSettlement === false && (target.section === "settled" || activeSettled)) {
    return { kind: "none" };
  }
  switch (target.section) {
    case "active": {
      const order = target.activeOrder;
      if (
        activeSection === "active" &&
        order.length === activeOrder.length &&
        order.every((key, index) => key === activeOrder[index])
      ) {
        return { kind: "none" };
      }
      const assignments = planPinnedReorder({
        orderedIds: order,
        keysById: activeKeysById,
        movedId: activeKey,
      });
      if (activeReorderableKeys && assignments.some(({ id }) => !activeReorderableKeys.has(id))) {
        return { kind: "none" };
      }
      return {
        kind: "move-active",
        order,
        assignments,
        unpin: activePinned,
        unsettle: activeSettled,
        unsnooze: activeSection === "snoozed",
      };
    }
    case "settled":
      return activeSection === "settled" ? { kind: "none" } : { kind: "settle" };
    case "pinned": {
      const order = target.pinnedOrder;
      // Dropped back where it started: nothing to write.
      if (
        activeSection === "pinned" &&
        order.length === pinnedOrder.length &&
        order.every((key, index) => key === pinnedOrder[index])
      ) {
        return { kind: "none" };
      }
      const assignments = planPinnedReorder({
        orderedIds: order,
        keysById: pinnedKeysById,
        movedId: activeKey,
      });
      if (reorderableKeys && assignments.some(({ id }) => !reorderableKeys.has(id))) {
        return { kind: "none" };
      }
      if (activeSection === "pinned") {
        return assignments.length === 0
          ? { kind: "none" }
          : { kind: "reorder-pinned", order, assignments };
      }
      return {
        kind: "pin",
        order,
        orderKey: assignments.find((assignment) => assignment.id === activeKey)?.orderKey,
        extraAssignments: activePinned
          ? assignments
          : assignments.filter((assignment) => assignment.id !== activeKey),
      };
    }
  }
}

/** Project a drop's lifecycle fields before sorting its destination. Reusing
    the server's re-entry rules keeps the preview in place when events arrive. */
export function applySidebarThreadDrop<
  T extends Pick<
    SidebarThreadSummary,
    | "pinnedAt"
    | "pinOrderKey"
    | "activeOrderKey"
    | "snoozedAt"
    | "snoozedUntil"
    | "settledAt"
    | "settledOverride"
    | "unsettledAt"
  >,
>(thread: T, section: "pinned" | "active" | "settled", now: string, orderKey?: string): T {
  const wasSettled = thread.settledOverride === "settled";
  const awake = { ...thread, snoozedAt: null, snoozedUntil: null };
  if (section === "settled") {
    return {
      ...awake,
      pinnedAt: null,
      pinOrderKey: null,
      activeOrderKey: null,
      settledOverride: "settled",
      settledAt: wasSettled ? (thread.settledAt ?? now) : now,
      unsettledAt: null,
    };
  }
  const resumed = wasSettled
    ? { ...awake, settledOverride: "active" as const, settledAt: null, unsettledAt: now }
    : awake;
  return {
    ...resumed,
    pinnedAt: section === "pinned" ? (thread.pinnedAt ?? now) : null,
    pinOrderKey: section === "pinned" ? (orderKey ?? thread.pinOrderKey) : null,
    ...(section === "active" && orderKey !== undefined ? { activeOrderKey: orderKey } : {}),
  };
}

type SidebarProject = {
  id: string;
  title: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

type ScopedSidebarProject = SidebarProject & {
  environmentId: string;
};

type ScopedSidebarThread = ThreadSortInput & {
  environmentId: string;
  projectId: string;
  archivedAt: string | null;
};

type LogicalSidebarProject = SidebarProject & {
  projectKey: string;
  memberProjectRefs: readonly {
    environmentId: string;
    projectId: string;
  }[];
};

export type ThreadTraversalDirection = "previous" | "next";

/**
 * Shared-worktree checks must exclude only successful deletions, never the
 * whole batch. A null result skips an entry that the caller can no longer find.
 */
export async function deleteSelectedThreadEntries<
  TEntry extends { readonly threadKey: string },
>(input: {
  entries: readonly TEntry[];
  delete: (
    entry: TEntry,
    deletedThreadKeys: ReadonlySet<string>,
  ) => Promise<AtomCommandResult<unknown, unknown> | null>;
}) {
  const deletedThreadKeys = new Set<string>();
  let firstFailure: AsyncResult.Failure<unknown, unknown> | null = null;

  for (const entry of input.entries) {
    const result = await input.delete(entry, deletedThreadKeys);
    if (result === null) continue;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) break;
      firstFailure ??= result;
      continue;
    }
    deletedThreadKeys.add(entry.threadKey);
  }

  return { deletedThreadKeys, firstFailure };
}

export async function archiveSelectedThreadEntries<
  TEntry extends { readonly threadKey: string },
  TResult extends { readonly _tag: "Success" | "Failure" },
>(input: {
  entries: readonly TEntry[];
  archive: (entry: TEntry, onArchived: () => void) => Promise<TResult>;
}): Promise<{
  archivedThreadKeys: readonly string[];
  mutationFailure: Extract<TResult, { readonly _tag: "Failure" }> | null;
  followupFailures: readonly Extract<TResult, { readonly _tag: "Failure" }>[];
}> {
  const archivedThreadKeys: string[] = [];
  const followupFailures: Extract<TResult, { readonly _tag: "Failure" }>[] = [];

  for (const entry of input.entries) {
    let didArchive = false;
    const result = await input.archive(entry, () => {
      didArchive = true;
    });
    if (didArchive || result._tag === "Success") {
      archivedThreadKeys.push(entry.threadKey);
    }
    if (result._tag === "Success") continue;
    const failure = result as Extract<TResult, { readonly _tag: "Failure" }>;
    if (didArchive) {
      followupFailures.push(failure);
      continue;
    }
    return { archivedThreadKeys, mutationFailure: failure, followupFailures };
  }

  return { archivedThreadKeys, mutationFailure: null, followupFailures };
}

export function buildMultiSelectThreadContextMenuItems(input: {
  count: number;
  hasRunningThread: boolean;
}): readonly ContextMenuItem<"mark-unread" | "archive" | "delete">[] {
  return [
    { id: "mark-unread", label: `Mark unread (${input.count})` },
    {
      id: "archive",
      label: `Archive (${input.count})`,
      disabled: input.hasRunningThread,
    },
    { id: "delete", label: `Delete (${input.count})`, destructive: true },
  ];
}

export function buildBulkTitleRegenerationContextMenuItem(input: {
  supportedCount: number;
  actionableCount: number;
}): ContextMenuItem<"regenerate-title"> | null {
  if (input.supportedCount === 0) return null;
  if (input.actionableCount === 0) {
    return {
      id: "regenerate-title",
      label: `Regenerating… (${input.supportedCount})`,
      disabled: true,
    };
  }
  return {
    id: "regenerate-title",
    label: `Regenerate titles (${input.actionableCount})`,
  };
}

/**
 * Bulk unpin follows the same "count only what the action will touch" rule
 * as title regeneration: on a mixed selection the label counts the pinned
 * rows alone, and the item disappears when nothing selected is pinned.
 */
export function buildBulkUnpinContextMenuItem(input: {
  pinnedCount: number;
}): ContextMenuItem<"unpin"> | null {
  if (input.pinnedCount === 0) return null;
  return { id: "unpin", label: `Unpin (${input.pinnedCount})` };
}

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Monitoring"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

// Rollup order mirrors the per-thread resolver exactly: attention states,
// then active work, then the actionable plan prompt, then passive
// monitoring. A Monitoring sibling must never hide a Plan Ready thread.
const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 6,
  "Awaiting Input": 5,
  Working: 4,
  Connecting: 4,
  "Plan Ready": 3,
  Monitoring: 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  SidebarThreadSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "backgroundLiveness"
> & {
  lastVisitedAt?: string | undefined;
};

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return false;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

// A double-click dispatches two `click` events before `dblclick`: the first has
// `detail === 1`, the second `detail === 2`. The second click must not run the
// row's single-click navigation, otherwise double-click-to-rename would also
// navigate. `MouseEvent.detail` is 0 for synthetic/keyboard activations, which
// still count as a normal single activation.
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

function nodeClosest(node: object | null, selector: string): unknown {
  if (node === null || !("closest" in node) || typeof node.closest !== "function") return null;
  return node.closest(selector);
}

/** Clicks on a nested link keep the link's meaning. The row must not treat them as multi-select. */
export function isSidebarNestedLinkClick(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return false;
  if (nodeClosest(target, "a[href]") !== null) return true;
  const parent =
    "parentElement" in target &&
    target.parentElement !== null &&
    typeof target.parentElement === "object"
      ? target.parentElement
      : null;
  return nodeClosest(parent, "a[href]") !== null;
}

// Shift+click on the new thread button creates directly in the current
// project, skipping the command palette's project picker. With a single
// project there is nothing to pick, so a plain click already creates
// immediately and the modifier changes nothing.
export function shouldCreateNewThreadInCurrentProject(
  shiftKey: boolean,
  projectGroupCount: number,
): boolean {
  return shiftKey || projectGroupCount <= 1;
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
  getPreferenceIds?: (item: TItem) => readonly TId[];
}): TItem[] {
  const { getId, getPreferenceIds, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const indexesByPreferenceId = new Map<TId, number[]>();
  for (const [index, item] of items.entries()) {
    const preferenceIds = getPreferenceIds?.(item) ?? [getId(item)];
    for (const preferenceId of new Set(preferenceIds)) {
      const indexes = indexesByPreferenceId.get(preferenceId);
      if (indexes) {
        indexes.push(index);
      } else {
        indexesByPreferenceId.set(preferenceId, [index]);
      }
    }
  }

  const emittedIndexes = new Set<number>();
  const ordered = preferredIds.flatMap((id) => {
    const index = indexesByPreferenceId
      .get(id)
      ?.find((candidate) => !emittedIndexes.has(candidate));
    if (index === undefined) {
      return [];
    }
    emittedIndexes.add(index);
    return [items[index]!];
  });
  const remaining = items.filter((_, index) => !emittedIndexes.has(index));
  return [...ordered, ...remaining];
}

export function getSidebarThreadIdsToPrewarm<TThreadId>(
  visibleThreadIds: readonly TThreadId[],
  limit = SIDEBAR_THREAD_PREWARM_LIMIT,
): TThreadId[] {
  return visibleThreadIds.slice(0, Math.max(0, limit));
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-8 w-full translate-x-0 cursor-pointer justify-start rounded-md px-2 text-left text-sm select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-sidebar-row-active text-sidebar-foreground font-medium hover:bg-sidebar-row-active hover:text-sidebar-foreground",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-sidebar-row-selected text-sidebar-foreground hover:bg-sidebar-row-active hover:text-sidebar-foreground",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-sidebar-row-active text-sidebar-foreground font-medium hover:bg-sidebar-row-active hover:text-sidebar-foreground",
    );
  }

  return cn(
    baseClassName,
    "text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
  );
}

// ── Sidebar thread status model ─────────────────────────────────────
// Five visual states, three colors: color is reserved for "act now"
// (approval), "in motion" (working), and "broken" (failed). Ready is the
// unlabeled resting state — the agent stopped and is waiting on the user,
// whether it finished, asked a question, or proposed a plan.
// Unread completion is tracked separately: it describes whether a ready
// thread needs attention, not what the thread is currently doing.
export type SidebarThreadStatus =
  | "approval"
  | "input"
  | "working"
  | "monitoring"
  | "failed"
  | "ready";

export function shouldRecedeSidebarThread(input: {
  status: SidebarThreadStatus;
  isUnread: boolean;
  isWoke: boolean;
  isActive: boolean;
  isSelected: boolean;
}): boolean {
  if (input.isActive || input.isSelected || input.status === "input") return false;
  if (input.status === "working" || input.status === "monitoring") return true;
  if (input.status === "ready" || input.status === "approval") {
    return !input.isUnread && !input.isWoke;
  }
  return false;
}

type SidebarThreadStatusInput = Pick<
  SidebarThreadSummary,
  "hasPendingApprovals" | "hasPendingUserInput" | "session" | "backgroundLiveness"
>;

export function resolveSidebarThreadStatus(thread: SidebarThreadStatusInput): SidebarThreadStatus {
  if (thread.hasPendingApprovals) {
    return "approval";
  }
  if (thread.hasPendingUserInput) {
    return "input";
  }
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return "working";
  }
  // A failed session outranks lingering background liveness: the user must
  // see the failure, not a stale Working (review finding).
  if (thread.session?.status === "error") {
    return "failed";
  }
  // Background work outlives the turn: fleets read as working; monitoring
  // only when watch loops are the sole live work.
  if (thread.backgroundLiveness === "working") {
    return "working";
  }
  if (thread.backgroundLiveness === "monitoring") {
    return "monitoring";
  }
  return "ready";
}

/** First VALID timestamp wins: `a ?? b` falls through on null, but a present-
    yet-malformed string must also fall through to the next candidate rather
    than sink the row to the epoch. */
export function firstValidTimestampMs(
  ...candidates: ReadonlyArray<string | null | undefined>
): number {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/** String twin of firstValidTimestampMs for callers that need the ISO string
    (display labels, tick anchors) rather than epoch ms. */
function firstValidTimestamp(
  ...candidates: ReadonlyArray<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (!Number.isNaN(Date.parse(candidate))) return candidate;
  }
  return null;
}

export { sortActiveThreadsByOrderKey as sortThreadsForSidebar } from "@e6tools/client-runtime/state/thread-sort";

// Pinned-reorder key math and the keyed sort live in client-runtime
// (state/thread-sort) so web and mobile compute identical pinned orders.
export { pinOrderKeyBetween, planPinnedReorder } from "@e6tools/client-runtime/state/thread-sort";
export { sortPinnedThreadsByOrderKey as sortPinnedThreadsForSidebar } from "@e6tools/client-runtime/state/thread-sort";

const EMPTY_CONTENT_MATCH_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Search the already-ordered sidebar thread collection by title or linked PR,
 * plus any thread whose messages the server matched (`contentMatchKeys`, keyed
 * by `threadSearchMatchKey`). Keeping the input order means lifecycle ordering
 * (active, snoozed, settled) remains stable while the user narrows the list.
 */
export function searchSidebarThreads<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly title: string;
  } & Parameters<typeof threadPullRequestSearchTerms>[0],
>(
  threads: readonly T[],
  query: string,
  contentMatchKeys: ReadonlySet<string> = EMPTY_CONTENT_MATCH_KEYS,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return [];
  const titleMatches: T[] = [];
  const contentMatches: T[] = [];
  for (const thread of threads) {
    const matchesTitle = [thread.title, ...threadPullRequestSearchTerms(thread)].some((term) =>
      term.toLowerCase().includes(normalizedQuery),
    );
    if (matchesTitle) {
      titleMatches.push(thread);
    } else if (
      contentMatchKeys.size > 0 &&
      contentMatchKeys.has(
        threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
      )
    ) {
      contentMatches.push(thread);
    }
  }
  return [...titleMatches, ...contentMatches];
}

export function filterSidebarProjectScopeItems<TItem extends { readonly value: string }>(input: {
  items: readonly TItem[];
  query: string;
  matches: (item: TItem, query: string) => boolean;
}): readonly TItem[] {
  const query = input.query.trim();
  if (query.length === 0) return input.items;
  return input.items.filter((item) => item.value !== "all" && input.matches(item, query));
}

export interface SidebarProjectScopeMenuState {
  readonly open: boolean;
  readonly query: string;
}

export type SidebarProjectScopeMenuAction =
  | { readonly type: "query-changed"; readonly query: string }
  | { readonly type: "open-changed"; readonly open: boolean }
  | { readonly type: "project-settings-opened" };

export function reduceSidebarProjectScopeMenuState(
  state: SidebarProjectScopeMenuState,
  action: SidebarProjectScopeMenuAction,
): SidebarProjectScopeMenuState {
  switch (action.type) {
    case "query-changed":
      return { ...state, query: action.query };
    case "open-changed":
      return { open: action.open, query: "" };
    case "project-settings-opened":
      return { open: false, query: "" };
  }
}

// Settled rows are history, so they order by when the work ENDED, not when
// the thread was created or last touched.
export function sortSettledThreadsForSidebar<
  T extends SettledThreadTimestampInput & { readonly id: string },
>(threads: readonly T[]): T[] {
  const timestampMs = (thread: T) => {
    const timestamp = resolveSettledThreadTimestamp(thread);
    return timestamp === null ? 0 : Date.parse(timestamp);
  };
  return [...threads].toSorted(
    (left, right) => timestampMs(right) - timestampMs(left) || left.id.localeCompare(right.id),
  );
}

/** The timestamp a working thread's elapsed label counts from: the running
    turn's start (request time until adoption), falling back to the session's
    last transition when the turn projection lags behind. Malformed
    timestamps fall through to the next candidate, not just missing ones. */
export function resolveWorkingStartedAt(
  thread: Pick<SidebarThreadSummary, "latestTurn" | "session">,
): string | null {
  const turn = thread.latestTurn;
  if (turn && turn.completedAt === null) {
    return firstValidTimestamp(turn.startedAt, turn.requestedAt, thread.session?.updatedAt);
  }
  return firstValidTimestamp(thread.session?.updatedAt);
}

export function formatWorkingDurationLabel(elapsedMs: number, clock = false): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (clock) {
    const pad = (value: number) => String(value).padStart(2, "0");
    const minutes = Math.floor(seconds / 60);
    return minutes < 60
      ? `${pad(minutes)}:${pad(seconds % 60)}`
      : `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
  }
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
}): ThreadStatusPill | null {
  const { thread } = input;

  if (thread.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (thread.hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "starting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  // An actionable plan prompt outranks lingering background work: it needs
  // the user's decision, while liveness merely reports (review finding).
  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  // The turn can settle while native background work runs on. Subagent and
  // workflow fleets read as plain Working; Monitoring is reserved for watch
  // loops (a parent agent babysitting a PR, tailing checks) with no other
  // live work. Same recede treatment as Working per inbox-zero.
  if (thread.backgroundLiveness === "working") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.backgroundLiveness === "monitoring") {
    return {
      label: "Monitoring",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveSidebarBranchStatus(input: {
  thread: ThreadStatusInput;
  isWoke?: boolean;
}): { status: SwitchboardStatus; label: string | null } {
  const { thread } = input;
  // Only branch rows show Error. A failed session cannot also be running or
  // starting, so approval and input are the only states that outrank it.
  if (
    thread.session?.status === "error" &&
    !thread.hasPendingApprovals &&
    !thread.hasPendingUserInput
  ) {
    return { status: "error", label: "Error" };
  }
  const pill = resolveThreadStatusPill({ thread });
  if (input.isWoke && (!pill || pill.label === "Completed")) {
    return { status: "woke", label: "Woke" };
  }
  if (!pill) return { status: "ready", label: null };
  return { status: PILL_STATUS_KIND[pill.label], label: pill.label };
}

const SIDEBAR_ROW_DESCRIPTION_PART_LENGTH = 120;
const SIDEBAR_ROW_DESCRIPTION_TRAILING_STOPS = /[\s.,;:…]+$/u;

/**
 * Joins what a switchboard row shows into the sentence its `aria-describedby`
 * reads: one line per part, capped, without trailing stops the joiner would double.
 */
export function joinSidebarRowDescription(
  parts: ReadonlyArray<string | false | null | undefined>,
): string {
  return parts
    .flatMap((part) => {
      if (!part) return [];
      // "!"/"?" only count as a trailing stop to drop after a letter, digit,
      // "." or ")": "Turn failed!" and "(x)!" end a sentence, but the "?" in
      // "+? −?" (an unknown diff count) sits after a symbol and stands for a
      // value. Stops are stripped again so "Done.!" doesn't leave "Done.".
      const line = (part.trim().split(/\r?\n/u)[0] ?? "")
        .slice(0, SIDEBAR_ROW_DESCRIPTION_PART_LENGTH)
        .replace(SIDEBAR_ROW_DESCRIPTION_TRAILING_STOPS, "")
        .replace(/(?<=[\p{L}\p{N}.)])[!?]+$/u, "")
        .replace(SIDEBAR_ROW_DESCRIPTION_TRAILING_STOPS, "");
      return line ? [line] : [];
    })
    .join(". ");
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}
export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly ThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function sortProjectsByActivity<TProject extends SidebarProject>(
  projects: readonly TProject[],
  sortOrder: SidebarProjectSortOrder,
  getProjectThreads: (project: TProject) => readonly ThreadSortInput[],
  compareTies: (left: TProject, right: TProject) => number,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(right, getProjectThreads(right), sortOrder);
    const leftTimestamp = getProjectSortTimestamp(left, getProjectThreads(left), sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    return byTimestamp || compareTies(left, right);
  });
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectId.get(project.id) ?? [],
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
}

export function sortLogicalProjectsForSidebar<
  TProject extends LogicalSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const groupKeyByProjectRef = new Map(
    projects.flatMap((project) =>
      project.memberProjectRefs.map(
        (projectRef) =>
          [`${projectRef.environmentId}\0${projectRef.projectId}`, project.projectKey] as const,
      ),
    ),
  );
  const threadsByProjectKey = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const projectKey = groupKeyByProjectRef.get(`${thread.environmentId}\0${thread.projectId}`);
    if (!projectKey) continue;
    const existing = threadsByProjectKey.get(projectKey);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByProjectKey.set(projectKey, [thread]);
    }
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectKey.get(project.projectKey) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) || left.projectKey.localeCompare(right.projectKey),
  );
}

/**
 * Sorts the cross-environment project collection used by landing surfaces.
 * Project ids are only unique within an environment, and archived threads
 * must not make a project appear recently active.
 */
export function sortScopedProjectsForSidebar<
  TProject extends ScopedSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const scopedKey = (environmentId: string, projectId: string) =>
    `${environmentId}\u0000${projectId}`;
  const threadsByProject = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) {
      continue;
    }
    const key = scopedKey(thread.environmentId, thread.projectId);
    const existing = threadsByProject.get(key) ?? [];
    existing.push(thread);
    threadsByProject.set(key, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProject.get(scopedKey(project.environmentId, project.id)) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.environmentId.localeCompare(right.environmentId) ||
      left.id.localeCompare(right.id),
  );
}

export interface SidebarProjectThreadGroup<T> {
  readonly projectKey: string;
  readonly displayName: string;
  readonly threadCount: number;
  /** Every thread in the group, rendered or not. */
  readonly threads: readonly T[];
  /** Rows to render: every thread when expanded, else only the open thread. */
  readonly rendered: readonly T[];
  readonly expanded: boolean;
  /** Threads waiting on the user, so a collapsed header can still say so. */
  readonly attentionCount: number;
}

/** Splits already-sorted active threads under their logical project, in
    project order. Threads whose project is unknown trail in one group. */
export function groupSidebarThreadsByProject<
  T extends { readonly environmentId: string; readonly projectId: string },
>(input: {
  readonly threads: readonly T[];
  readonly projects: ReadonlyArray<{
    readonly projectKey: string;
    readonly displayName: string;
    readonly memberProjects: ReadonlyArray<{ readonly environmentId: string; readonly id: string }>;
  }>;
  readonly isExpanded: (projectKey: string) => boolean;
  readonly needsAttention: (thread: T) => boolean;
  readonly isRouteThread: (thread: T) => boolean;
}): SidebarProjectThreadGroup<T>[] {
  const groupKeyByProject = new Map<string, string>();
  for (const project of input.projects) {
    for (const member of project.memberProjects) {
      groupKeyByProject.set(`${member.environmentId}:${member.id}`, project.projectKey);
    }
  }
  const OTHER = "\0other";
  const threadsByGroup = new Map<string, T[]>();
  for (const thread of input.threads) {
    const key = groupKeyByProject.get(`${thread.environmentId}:${thread.projectId}`) ?? OTHER;
    const list = threadsByGroup.get(key);
    if (list) list.push(thread);
    else threadsByGroup.set(key, [thread]);
  }
  const ordered = [
    ...input.projects.map((project) => ({ key: project.projectKey, name: project.displayName })),
    { key: OTHER, name: "Other" },
  ];
  return ordered.flatMap(({ key, name }) => {
    const threads = threadsByGroup.get(key);
    if (!threads) return [];
    const expanded = input.isExpanded(key);
    return [
      {
        projectKey: key,
        displayName: name,
        threadCount: threads.length,
        threads,
        rendered: expanded ? threads : threads.filter(input.isRouteThread),
        expanded,
        attentionCount: threads.filter(input.needsAttention).length,
      },
    ];
  });
}

export type ProjectStatusKind =
  | "approval"
  | "input"
  | "plan"
  | "working"
  | "connecting"
  | "monitoring"
  | "completed";

export interface ProjectSidebarCounts {
  readonly needYou: number;
  readonly live: number;
  readonly threads: number;
  readonly worktrees: number;
  readonly badge: { readonly status: ProjectStatusKind; readonly count: number } | null;
  readonly liveDot: boolean;
}

export type ProjectCountThread = ThreadStatusInput & {
  readonly environmentId: string;
  readonly projectId: string;
  readonly archivedAt: string | null;
  readonly settledOverride: string | null;
  readonly worktreePath: string | null;
};

export type SwitchboardStatFilter = "need-you" | "live" | "threads" | "worktrees";

const PILL_STATUS_KIND = {
  "Pending Approval": "approval",
  "Awaiting Input": "input",
  "Plan Ready": "plan",
  Working: "working",
  Connecting: "connecting",
  Monitoring: "monitoring",
  Completed: "completed",
} as const satisfies Record<ThreadStatusPill["label"], ProjectStatusKind>;

const NEED_YOU_LABELS = new Set<ThreadStatusPill["label"]>([
  "Pending Approval",
  "Awaiting Input",
  "Plan Ready",
]);

const LIVE_LABELS = new Set<ThreadStatusPill["label"]>(["Working", "Connecting", "Monitoring"]);

const EMPTY_PROJECT_COUNTS: ProjectSidebarCounts = {
  needYou: 0,
  live: 0,
  threads: 0,
  worktrees: 0,
  badge: null,
  liveDot: false,
};

export function countProjectSidebarThreads(
  threads: readonly ProjectCountThread[],
): ProjectSidebarCounts {
  let needYou = 0;
  let live = 0;
  let threadCount = 0;
  const worktrees = new Set<string>();
  const pills: Array<ThreadStatusPill | null> = [];

  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    if (thread.worktreePath) worktrees.add(thread.worktreePath);
    if (thread.settledOverride !== "settled") threadCount += 1;
    const pill = resolveThreadStatusPill({ thread });
    pills.push(pill);
    if (!pill) continue;
    if (NEED_YOU_LABELS.has(pill.label)) needYou += 1;
    if (LIVE_LABELS.has(pill.label)) live += 1;
  }

  let attention: ThreadStatusPill | null = null;
  for (const pill of pills) {
    if (!pill || !NEED_YOU_LABELS.has(pill.label)) continue;
    if (
      attention === null ||
      THREAD_STATUS_PRIORITY[pill.label] > THREAD_STATUS_PRIORITY[attention.label]
    ) {
      attention = pill;
    }
  }

  return {
    needYou,
    live,
    threads: threadCount,
    worktrees: worktrees.size,
    badge:
      attention === null || needYou === 0
        ? null
        : { status: PILL_STATUS_KIND[attention.label], count: needYou },
    liveDot: live > 0,
  };
}

export function countThreadsForLogicalProject(
  project: LogicalSidebarProject,
  threads: readonly ProjectCountThread[],
): ProjectSidebarCounts {
  const memberKeys = new Set(
    project.memberProjectRefs.map(
      (projectRef) => `${projectRef.environmentId}\0${projectRef.projectId}`,
    ),
  );
  return countProjectSidebarThreads(
    threads.filter((thread) => memberKeys.has(`${thread.environmentId}\0${thread.projectId}`)),
  );
}

export function threadMatchesSwitchboardStatFilter(
  thread: ProjectCountThread,
  filter: SwitchboardStatFilter,
): boolean {
  if (thread.archivedAt !== null) return false;
  if (filter === "threads") return thread.settledOverride !== "settled";
  if (filter === "worktrees") return thread.worktreePath !== null && thread.worktreePath.length > 0;
  const pill = resolveThreadStatusPill({ thread });
  if (!pill) return false;
  return filter === "need-you" ? NEED_YOU_LABELS.has(pill.label) : LIVE_LABELS.has(pill.label);
}

export type SidebarGroupBy = "branch" | "status" | "project";

/** The mode the switchboard list renders. A stat filter overrides the saved
 * mode for as long as it is active, and Project needs the All projects scope;
 * neither override is ever written back to the saved mode. */
export function resolveSidebarGroupBy(input: {
  readonly saved: SidebarGroupBy;
  readonly statFilter: SwitchboardStatFilter | null;
  readonly allProjects: boolean;
}): SidebarGroupBy {
  if (input.statFilter === "need-you") return "status";
  if (input.statFilter === "worktrees") return "branch";
  if (input.saved === "project" && !input.allProjects) return "branch";
  return input.saved;
}

/** The lifecycle bucket a visible thread renders in. Snooze outranks
 * settlement and pinning until the thread wakes, and a shelf outranks the
 * pin; the pin itself is kept, so waking or un-settling a pinned thread puts
 * it back under Pinned without a write. Group-by modes only arrange the
 * `active` bucket. */
export function sidebarThreadLifecycleSection(
  thread: Parameters<typeof effectiveSnoozed>[0] &
    Pick<SidebarThreadSummary, "settledOverride" | "pinnedAt">,
  options: {
    readonly now: string;
    readonly supportsSnooze: boolean;
    readonly supportsSettlement: boolean;
  },
): SidebarSection {
  if (options.supportsSnooze && effectiveSnoozed(thread, { now: options.now })) return "snoozed";
  if (options.supportsSettlement && thread.settledOverride === "settled") return "settled";
  if (thread.pinnedAt != null) return "pinned";
  return "active";
}

export type SidebarStatusSectionKey = "needs-you" | "error" | "running" | "idle";

export const SIDEBAR_STATUS_SECTION_LABELS: Record<SidebarStatusSectionKey, string> = {
  "needs-you": "Needs you",
  error: "Error",
  running: "Running",
  idle: "Idle",
};

const SIDEBAR_STATUS_SECTION_ORDER: readonly SidebarStatusSectionKey[] = [
  "needs-you",
  "error",
  "running",
  "idle",
];

/** The Status-mode section a thread falls in, first match wins. Needs you and
 * Running are exactly the masthead's need-you and live stats; Idle takes the
 * rest, so every thread has a section. Pinned, snoozed and settled threads
 * never reach this: they keep their own lane and shelves. */
function sidebarStatusSectionOf(thread: ProjectCountThread): SidebarStatusSectionKey {
  if (threadMatchesSwitchboardStatFilter(thread, "need-you")) return "needs-you";
  if (resolveSidebarThreadStatus(thread) === "failed") return "error";
  if (threadMatchesSwitchboardStatFilter(thread, "live")) return "running";
  return "idle";
}

/** Status-mode sections in display order, empty ones left out. Rows keep the
 * order they arrive in. */
export function groupSidebarThreadsByStatus<T extends ProjectCountThread>(
  activeThreads: readonly T[],
): { readonly key: SidebarStatusSectionKey; readonly threads: readonly T[] }[] {
  const buckets = new Map<SidebarStatusSectionKey, T[]>();
  for (const thread of activeThreads) {
    const key = sidebarStatusSectionOf(thread);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(thread);
    else buckets.set(key, [thread]);
  }
  return SIDEBAR_STATUS_SECTION_ORDER.flatMap((key) => {
    const threads = buckets.get(key);
    return threads ? [{ key, threads }] : [];
  });
}

export type LanePullRequestState = "open" | "draft" | "merged" | "closed";

export interface LanePullRequestSummary {
  readonly number: number;
  readonly url: string;
  /** Null when only the branch's own pull request is known and no linked
   * snapshot says what state it is in. */
  readonly state: LanePullRequestState | null;
  /** Distinct pull requests across the lane, the chosen one included. */
  readonly count: number;
}

const OPEN_LANE_PR_STATES: ReadonlySet<LanePullRequestState> = new Set(["open", "draft"]);

/** The one pull request a lane header shows. The lane's branch pull request
 * wins; otherwise the most recently updated open or draft link, then the most
 * recently updated merged or closed one, ties to the higher number. Only the
 * chosen pull request's own state is reported. */
export function pickLanePullRequest(
  threads: readonly Pick<SidebarThreadSummary, "branchPullRequest" | "pullRequests">[],
): LanePullRequestSummary | null {
  const links = new Map<
    string,
    { number: number; url: string; state: LanePullRequestState | null; updatedAt: number }
  >();
  let branch: { key: string; number: number; url: string } | null = null;
  for (const thread of threads) {
    for (const link of visibleThreadPullRequests(thread.pullRequests ?? [])) {
      const key = threadPullRequestKeyOf(link);
      const updatedAt = threadPullRequestUpdatedAt(link);
      const existing = links.get(key);
      if (existing && existing.updatedAt >= updatedAt) continue;
      links.set(key, {
        number: link.number,
        url: link.url,
        state:
          link.snapshot === null
            ? null
            : link.snapshot.state === "open" && link.snapshot.isDraft
              ? "draft"
              : link.snapshot.state,
        updatedAt,
      });
    }
    if (branch === null && thread.branchPullRequest) {
      const pr = thread.branchPullRequest;
      branch = {
        key: threadPullRequestKeyOf(legacyThreadPullRequestKey(pr)),
        number: pr.number,
        url: pr.url,
      };
    }
  }
  const count = links.size + (branch !== null && !links.has(branch.key) ? 1 : 0);
  if (branch !== null) {
    return {
      number: branch.number,
      url: branch.url,
      state: links.get(branch.key)?.state ?? null,
      count,
    };
  }
  const rank = (state: LanePullRequestState | null) =>
    state === null ? 0 : OPEN_LANE_PR_STATES.has(state) ? 2 : 1;
  const chosen = [...links.values()].sort(
    (a, b) => rank(b.state) - rank(a.state) || b.updatedAt - a.updatedAt || b.number - a.number,
  )[0];
  return chosen ? { number: chosen.number, url: chosen.url, state: chosen.state, count } : null;
}

export function selectSwitchboardRailProjects<
  TProject extends LogicalSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  return sortLogicalProjectsForSidebar(projects, threads, sortOrder);
}
