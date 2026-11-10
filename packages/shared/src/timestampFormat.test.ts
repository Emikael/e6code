// @effect-diagnostics globalDate:off -- Local-time instants keep calendar-day boundaries deterministic.
import { describe, expect, it } from "vite-plus/test";

import { makeTimestampFormatters } from "./timestampFormat.ts";

const { formatShortTimestamp, formatUpcomingTimestamp } = makeTimestampFormatters(undefined);

describe("formatUpcomingTimestamp", () => {
  // Local-time constructor so the calendar-day boundaries hold in any timezone.
  const iso = (y: number, monthIndex: number, d: number, h: number, mi: number) =>
    new Date(y, monthIndex, d, h, mi).toISOString();
  const now = new Date(2026, 7, 14, 12, 0).getTime();
  const time = (isoDate: string) => formatShortTimestamp(isoDate, "24-hour");

  it("shows time only for later today", () => {
    const resetAt = iso(2026, 7, 14, 18, 5);
    expect(formatUpcomingTimestamp(resetAt, "24-hour", now)).toBe(time(resetAt));
  });

  it("labels the next calendar day as tomorrow even when under 24h away", () => {
    const resetAt = iso(2026, 7, 15, 0, 30);
    const lateEvening = new Date(2026, 7, 14, 23, 50).getTime();
    expect(formatUpcomingTimestamp(resetAt, "24-hour", lateEvening)).toBe(
      `tomorrow at ${time(resetAt)}`,
    );
  });

  it("prefixes later days with the numeric date, and the year once it differs", () => {
    const later = iso(2026, 7, 20, 9, 0);
    const nextYear = iso(2027, 0, 2, 9, 0);
    const date = (isoDate: string, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(undefined, options).format(new Date(isoDate));
    expect(formatUpcomingTimestamp(later, "24-hour", now)).toBe(
      `${date(later, { month: "numeric", day: "numeric" })} ${time(later)}`,
    );
    expect(formatUpcomingTimestamp(nextYear, "24-hour", now)).toBe(
      `${date(nextYear, { month: "numeric", day: "numeric", year: "numeric" })} ${time(nextYear)}`,
    );
  });

  it("respects the 12/24-hour setting and returns empty for invalid input", () => {
    const resetAt = iso(2026, 7, 14, 14, 20);
    expect(formatShortTimestamp(resetAt, "24-hour")).toContain("14");
    expect(formatShortTimestamp(resetAt, "12-hour")).not.toContain("14");
    expect(formatUpcomingTimestamp("not-a-date", "locale", now)).toBe("");
  });
});
