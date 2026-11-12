/**
 * Session clock and break reminder (F5, board 7). Session time runs from the
 * day's first interaction on this device and never leaves it: it is kept in
 * local storage and never sent to a server. Both features are opt in.
 */
import { create } from "zustand";

import { localDateKey } from "./parkedThoughts";

const SESSION_CLOCK_STORAGE_KEY = "e6code:session-clock:v1";
const MINUTE_MS = 60_000;
/** "Remind me in 30m". */
export const BREAK_SNOOZE_MINUTES = 30;
/**
 * No interaction for this long counts as a real break: the next interaction
 * starts a new session, so the reminder does not keep returning all day. Longer
 * than the recap's 5-minute break, because reading a long reply without a click
 * is not a break.
 */
export const SESSION_BREAK_MINUTES = 15;

export interface SessionClockState {
  /** `localDateKey` of the day the session belongs to. */
  readonly day: string;
  /** Epoch ms of the day's first interaction. */
  readonly startedAt: number;
  /** Epoch ms before which the break reminder stays quiet (snoozed or dismissed). */
  readonly quietUntil: number | null;
  /** Epoch ms of the latest interaction, to the minute. */
  readonly lastActiveAt: number;
}

/**
 * The session still running at `nowMs`, or null when it belongs to another day
 * or a break has passed since its last interaction. A page left open overnight
 * then shows nothing until the next interaction starts today's session.
 */
export function liveSession(
  stored: SessionClockState | null,
  nowMs: number,
): SessionClockState | null {
  if (!stored || stored.day !== localDateKey(nowMs) || stored.startedAt > nowMs) return null;
  if (nowMs - stored.lastActiveAt > SESSION_BREAK_MINUTES * MINUTE_MS) return null;
  return stored;
}

/**
 * The session after an interaction at `nowMs`: the running one, with its last
 * activity moved on once a minute at most, or a new one starting now.
 */
export function resolveSession(stored: SessionClockState | null, nowMs: number): SessionClockState {
  const live = liveSession(stored, nowMs);
  if (!live)
    return { day: localDateKey(nowMs), startedAt: nowMs, quietUntil: null, lastActiveAt: nowMs };
  if (nowMs - live.lastActiveAt < MINUTE_MS) return live;
  return { ...live, lastActiveAt: nowMs };
}

/** "Session 1h 30m", in whole minutes. */
export function formatSessionLength(startedAt: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - startedAt) / MINUTE_MS));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `Session ${hours > 0 ? `${hours}h ${rest}m` : `${rest}m`}`;
}

/** Whether the reminder line shows: the session is past the chosen length and not quieted. */
export function isBreakReminderDue(
  session: SessionClockState,
  reminderMinutes: number | "off",
  nowMs: number,
): boolean {
  if (reminderMinutes === "off") return false;
  if (nowMs - session.startedAt < reminderMinutes * MINUTE_MS) return false;
  return session.quietUntil === null || nowMs >= session.quietUntil;
}

/**
 * Dismiss quiets the reminder for another full interval; "Remind me in 30m"
 * quiets it for 30 minutes.
 */
export function quietBreakReminder(
  session: SessionClockState,
  nowMs: number,
  minutes: number,
): SessionClockState {
  return { ...session, quietUntil: nowMs + minutes * MINUTE_MS };
}

function readStored(): SessionClockState | null {
  try {
    const raw = localStorage.getItem(SESSION_CLOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionClockState> | null;
    if (typeof parsed?.day !== "string" || typeof parsed.startedAt !== "number") return null;
    return {
      day: parsed.day,
      startedAt: parsed.startedAt,
      quietUntil: typeof parsed.quietUntil === "number" ? parsed.quietUntil : null,
      lastActiveAt:
        typeof parsed.lastActiveAt === "number" ? parsed.lastActiveAt : parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function writeStored(state: SessionClockState): void {
  try {
    localStorage.setItem(SESSION_CLOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Without storage the session lasts as long as this page; nothing else depends on it.
  }
}

export const useSessionClockStore = create<{ readonly session: SessionClockState | null }>()(
  () => ({ session: null }),
);

function commit(next: SessionClockState): void {
  if (useSessionClockStore.getState().session === next) return;
  writeStored(next);
  useSessionClockStore.setState({ session: next });
}

/** Starts today's session on the first interaction of a new day. */
function noteInteraction(): void {
  const current = useSessionClockStore.getState().session;
  commit(resolveSession(current, Date.now()));
}

let tracking = false;
const LISTENER_OPTIONS = { capture: true, passive: true } as const;

/**
 * Begins counting on this device. Called only while the clock or the reminder
 * is on, so nothing is recorded for people who never turn them on.
 */
export function ensureSessionTracking(): void {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  commit(resolveSession(readStored(), Date.now()));
  window.addEventListener("pointerdown", noteInteraction, LISTENER_OPTIONS);
  window.addEventListener("keydown", noteInteraction, LISTENER_OPTIONS);
}

/** With the clock and the reminder both off: stop listening and forget the session. */
export function stopSessionTracking(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("pointerdown", noteInteraction, LISTENER_OPTIONS);
    window.removeEventListener("keydown", noteInteraction, LISTENER_OPTIONS);
  }
  tracking = false;
  try {
    localStorage.removeItem(SESSION_CLOCK_STORAGE_KEY);
  } catch {
    // Nothing stored, or storage is blocked; either way nothing is kept.
  }
  useSessionClockStore.setState({ session: null });
}

export function quietSessionReminder(minutes: number): void {
  const session = useSessionClockStore.getState().session;
  if (session) commit(quietBreakReminder(session, Date.now(), minutes));
}
