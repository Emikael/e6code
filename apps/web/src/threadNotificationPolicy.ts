import type { ClientSettings } from "@e6tools/contracts/settings";

/**
 * Who calls you back, and when. Blocked agents and the thread you are
 * waiting on reach you now; everything else waits for a pause and arrives
 * as one digest.
 *
 * - `os`: a system notification now (the window is in the background).
 * - `toast`: an in-app toast now.
 * - `held`: kept until you return to the window, then shown as its own toast.
 *   A blocked agent lands here when system notifications are unavailable.
 * - `digest`: held until the next breakpoint, then shown as a toast.
 * - `none`: nothing extra; the thread view, or another window, already shows it.
 */
export type ThreadNotificationDelivery = "os" | "toast" | "held" | "digest" | "none";

/** `blocked`: an approval, a question or a failure. `finished`: a turn completed. */
export type ThreadNotificationEvent = "blocked" | "finished";

export type ThreadNotificationSettings = Pick<
  ClientSettings,
  "attentionNotifications" | "notifyWatchedThreads" | "holdFinishedUntilBreakpoint"
>;

export interface ThreadNotificationContext {
  readonly event: ThreadNotificationEvent;
  /** The window is visible and has focus. */
  readonly windowFocused: boolean;
  /** Another window of the app, on this origin, has focus and delivers instead. */
  readonly anotherWindowFocused: boolean;
  /**
   * System notifications can be shown: permission granted in a secure
   * context. False on a fresh web profile, after "Not now" or a denial, and
   * on plain-http remote origins.
   */
  readonly systemNotificationsAvailable: boolean;
  /** The thread is the one open in this window. */
  readonly isOpenThread: boolean;
  /** You sent the turn that just ended and asked to hear when it finishes. */
  readonly watched: boolean;
  /** Focus mode holds finished threads until you exit it. */
  readonly focusHold: boolean;
  readonly settings: ThreadNotificationSettings;
}

export function resolveThreadNotificationDelivery(
  context: ThreadNotificationContext,
): ThreadNotificationDelivery {
  const { event, windowFocused, isOpenThread, settings } = context;
  if (settings.attentionNotifications === "off") return "none";
  // The thread in front of you already shows its own state.
  if (windowFocused && isOpenThread) return "none";
  // The focused window raises its own toast; a second notice here would repeat it.
  if (!windowFocused && context.anotherWindowFocused) return "none";
  if (event === "blocked") {
    if (windowFocused) return "toast";
    return context.systemNotificationsAvailable ? "os" : "held";
  }

  const watched = context.watched && settings.notifyWatchedThreads;
  // In focus mode only the focused thread's own completion comes through.
  if (context.focusHold && !isOpenThread) return "digest";
  if (watched || settings.attentionNotifications === "all") {
    // Without system notifications a finish waits for your return, like the digest.
    if (!windowFocused) return context.systemNotificationsAvailable ? "os" : "digest";
    return watched && settings.holdFinishedUntilBreakpoint ? "digest" : "toast";
  }
  // Under "blocked", other finished threads never raise a system
  // notification; with nobody looking they wait for the window to return.
  if (!windowFocused || settings.holdFinishedUntilBreakpoint) return "digest";
  return "toast";
}

interface HeldThreadNotice {
  readonly key: string;
  readonly kind: ThreadNotificationKind;
  readonly watched: boolean;
  readonly heldAtMs: number;
}

/**
 * Splits what was held when a breakpoint comes. Items for the thread you
 * have open, or opened after they were held, are dropped: you have seen them.
 * Blocked items and watched finishes get their own toast; other finishes
 * share one digest. Focus mode keeps the finishes for later.
 */
export function selectHeldForFlush<T extends HeldThreadNotice>(
  held: ReadonlyArray<T>,
  input: {
    readonly openThreadKey: string | null;
    readonly visitedAtMsByKey: ReadonlyMap<string, number>;
    readonly focusHold: boolean;
  },
): { readonly own: T[]; readonly digest: T[]; readonly keep: T[] } {
  const own: T[] = [];
  const digest: T[] = [];
  const keep: T[] = [];
  for (const notice of [...held].sort((a, b) => a.heldAtMs - b.heldAtMs)) {
    if (notice.key === input.openThreadKey) continue;
    const visitedAtMs = input.visitedAtMsByKey.get(notice.key);
    if (visitedAtMs !== undefined && visitedAtMs >= notice.heldAtMs) continue;
    if (notice.kind !== "completion") own.push(notice);
    else if (input.focusHold) keep.push(notice);
    else if (notice.watched) own.push(notice);
    else digest.push(notice);
  }
  return { own, digest, keep };
}

/**
 * Groups one pass of deliveries. More than one finish delivered the same way
 * (toast or system notification) becomes a single "N threads finished";
 * blocked items and a lone finish stay their own notice.
 */
export function groupThreadDeliveries<T extends { readonly kind: ThreadNotificationKind }>(
  deliveries: ReadonlyArray<{ readonly notice: T; readonly delivery: "os" | "toast" }>,
): Array<{ readonly delivery: "os" | "toast"; readonly notices: T[] }> {
  const groups: Array<{ delivery: "os" | "toast"; notices: T[] }> = [];
  const finished = { os: [] as T[], toast: [] as T[] };
  for (const { notice, delivery } of deliveries) {
    if (notice.kind === "completion") finished[delivery].push(notice);
    else groups.push({ delivery, notices: [notice] });
  }
  for (const delivery of ["toast", "os"] as const) {
    const notices = finished[delivery];
    if (notices.length > 0) groups.push({ delivery, notices });
  }
  return groups;
}

/** "2 threads finished". */
export function finishedDigestTitle(count: number): string {
  return `${count} threads finished`;
}

/** Twenty seconds without a key or pointer press counts as a pause. */
export const DIGEST_IDLE_BREAKPOINT_MS = 20_000;
/** Nothing waits in the digest longer than this. */
export const DIGEST_MAX_HOLD_MS = 5 * 60_000;

/**
 * When the held digest should be shown, in epoch ms, from the time of the
 * last key or pointer input and the time the oldest item was held. Sending
 * a message, switching thread and the window regaining focus are breakpoints
 * too; callers flush on those directly. Null while focus mode holds it, or
 * when nothing is held.
 */
export function nextDigestFlushAtMs(input: {
  readonly oldestHeldAtMs: number | null;
  readonly lastInputAtMs: number;
  readonly focusHold: boolean;
}): number | null {
  if (input.oldestHeldAtMs === null || input.focusHold) return null;
  return Math.min(
    Math.max(input.lastInputAtMs, input.oldestHeldAtMs) + DIGEST_IDLE_BREAKPOINT_MS,
    input.oldestHeldAtMs + DIGEST_MAX_HOLD_MS,
  );
}

export type ThreadNotificationKind = "approval" | "input" | "failed" | "completion";

export const THREAD_NOTIFICATION_TITLES = {
  approval: "Approval needed",
  input: "Input needed",
  failed: "Thread failed",
  completion: "Thread completed",
} satisfies Record<ThreadNotificationKind, string>;

interface NotificationThread {
  readonly title: string;
  readonly session: {
    readonly providerName: string | null;
    readonly lastError: string | null;
  } | null;
  readonly latestTurn: {
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  } | null;
}

/** "45s", "3m 40s", "1h 5m". */
export function formatWorkedDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  return minutes % 60 === 0
    ? `${Math.floor(minutes / 60)}h`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const MAX_ERROR_LENGTH = 120;

/**
 * The one fact a notification adds to the thread title: who is waiting and
 * on what, why it stopped, or how long it worked. Null when nothing is known.
 */
export function threadNotificationFact(
  thread: NotificationThread,
  kind: ThreadNotificationKind,
  providerLabel: (providerName: string) => string | undefined,
): string | null {
  const providerName = thread.session?.providerName;
  const provider = (providerName && providerLabel(providerName)) || "The agent";
  switch (kind) {
    case "approval":
      return `${provider} is waiting for your approval`;
    case "input":
      return `${provider} asked you a question`;
    case "failed": {
      const error = thread.session?.lastError;
      if (!error) return `${provider} stopped`;
      const firstLine = error.split("\n", 1)[0] ?? error;
      return `${provider} stopped: ${
        firstLine.length > MAX_ERROR_LENGTH
          ? `${firstLine.slice(0, MAX_ERROR_LENGTH - 1)}…`
          : firstLine
      }`;
    }
    case "completion": {
      const startedMs = Date.parse(thread.latestTurn?.startedAt ?? "");
      const completedMs = Date.parse(thread.latestTurn?.completedAt ?? "");
      if (Number.isNaN(startedMs) || Number.isNaN(completedMs)) return null;
      return `worked ${formatWorkedDuration(completedMs - startedMs)}`;
    }
  }
}

/** Notification body: the thread title plus one fact. */
export function threadNotificationBody(
  thread: NotificationThread,
  kind: ThreadNotificationKind,
  providerLabel: (providerName: string) => string | undefined,
): string {
  const fact = threadNotificationFact(thread, kind, providerLabel);
  return fact ? `${thread.title} · ${fact}` : thread.title;
}
