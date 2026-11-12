import { describe, expect, it } from "vite-plus/test";

import {
  formatSessionLength,
  isBreakReminderDue,
  liveSession,
  quietBreakReminder,
  resolveSession,
  SESSION_BREAK_MINUTES,
} from "./sessionClock";

const at = (time: string) => new Date(`2026-11-12T${time}`).getTime();

describe("resolveSession", () => {
  it("keeps today's session and starts a new one on a new day", () => {
    const first = resolveSession(null, at("09:00:00"));
    expect(first.startedAt).toBe(at("09:00:00"));
    expect(resolveSession(first, at("09:00:30"))).toBe(first);
    const later = resolveSession(first, at("09:10:00"));
    expect(later.startedAt).toBe(at("09:00:00"));
    const tomorrow = new Date(2026, 10, 13, 8, 0).getTime();
    expect(resolveSession(first, tomorrow).startedAt).toBe(tomorrow);
  });
});

describe("breaks and stale days", () => {
  it("starts a new session after a break, so the reminder does not return all day", () => {
    const morning = resolveSession(null, at("09:00:00"));
    const active = resolveSession(morning, at("09:14:00"));
    const breakEnds = at("09:14:00") + (SESSION_BREAK_MINUTES + 1) * 60_000;
    expect(liveSession(active, breakEnds)).toBeNull();
    const afterBreak = resolveSession(active, breakEnds);
    expect(afterBreak.startedAt).toBe(breakEnds);
    expect(isBreakReminderDue(afterBreak, 50, breakEnds + 10 * 60_000)).toBe(false);
  });

  it("ignores a stored session from another day", () => {
    const yesterday = resolveSession(null, new Date(2026, 10, 11, 23, 55).getTime());
    expect(liveSession(yesterday, new Date(2026, 10, 12, 0, 5).getTime())).toBeNull();
  });
});

describe("formatSessionLength", () => {
  it("reads whole minutes, with hours past the hour", () => {
    expect(formatSessionLength(at("09:00:00"), at("09:12:59"))).toBe("Session 12m");
    expect(formatSessionLength(at("09:00:00"), at("10:30:00"))).toBe("Session 1h 30m");
  });
});

describe("isBreakReminderDue", () => {
  const session = resolveSession(null, at("09:00:00"));

  it("stays off when the reminder is off or the session is short", () => {
    expect(isBreakReminderDue(session, "off", at("12:00:00"))).toBe(false);
    expect(isBreakReminderDue(session, 50, at("09:49:00"))).toBe(false);
    expect(isBreakReminderDue(session, 50, at("09:50:00"))).toBe(true);
  });

  it("waits out a snooze or a dismissal", () => {
    const snoozed = quietBreakReminder(session, at("09:50:00"), 30);
    expect(isBreakReminderDue(snoozed, 50, at("10:19:00"))).toBe(false);
    expect(isBreakReminderDue(snoozed, 50, at("10:20:00"))).toBe(true);
  });
});
