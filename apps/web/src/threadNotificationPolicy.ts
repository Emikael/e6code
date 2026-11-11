import type { ClientSettings } from "@e6tools/contracts/settings";

/**
 * Who calls you back, and when. Blocked agents and the thread you are
 * waiting on reach you now; everything else waits for a pause and arrives
 * as one digest.
 *
 * - `os`: a system notification now (the window is in the background).
 * - `toast`: an in-app toast now.
 * - `digest`: held until the next breakpoint, then shown as a toast.
 * - `none`: nothing extra; the thread view already shows it.
 */
export type ThreadNotificationDelivery = "os" | "toast" | "digest" | "none";

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
  if (event === "blocked") return windowFocused ? "toast" : "os";

  const watched = context.watched && settings.notifyWatchedThreads;
  // In focus mode only the focused thread's own completion comes through.
  if (context.focusHold && !isOpenThread) return "digest";
  if (watched || settings.attentionNotifications === "all") {
    if (!windowFocused) return "os";
    return watched && settings.holdFinishedUntilBreakpoint ? "digest" : "toast";
  }
  // Under "blocked", other finished threads never raise a system
  // notification; with nobody looking they wait for the window to return.
  if (!windowFocused || settings.holdFinishedUntilBreakpoint) return "digest";
  return "toast";
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
