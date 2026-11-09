// @effect-diagnostics globalDate:off -- Wall-clock labels are relative to the viewer's local calendar day.
/**
 * Wall-clock timestamp labels shared by web and mobile, so a usage-limit reset
 * or a chat time reads the same on every client.
 *
 * @module timestampFormat
 */
import type { TimestampFormat } from "@e6tools/contracts/settings";

const DAY_MS = 86_400_000;

export function parseTimestampDate(isoDate: string): Date | null {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampFormatOptions(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormatOptions {
  const baseOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  };
  if (timestampFormat === "locale") return baseOptions;
  return { ...baseOptions, hour12: timestampFormat === "12-hour" };
}

/** Whole local calendar days from `fromMs` to `date`; DST-shifted days still count as one. */
function calendarDayDiff(date: Date, fromMs: number): number {
  const from = new Date(fromMs);
  const startOfFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDate - startOfFrom) / DAY_MS);
}

/**
 * Builds the timestamp formatters for one locale. Pass `undefined` for the
 * runtime default; a host that knows the user's locale better (desktop) passes
 * its own. Formatters are cached per format, so calls are cheap in lists.
 */
export function makeTimestampFormatters(locale: string | undefined) {
  const timeFormatters = new Map<string, Intl.DateTimeFormat>();
  const timeFormatter = (timestampFormat: TimestampFormat, includeSeconds: boolean) => {
    const key = `${timestampFormat}:${includeSeconds ? "seconds" : "minutes"}`;
    const cached = timeFormatters.get(key);
    if (cached) return cached;
    const formatter = new Intl.DateTimeFormat(
      locale,
      timestampFormatOptions(timestampFormat, includeSeconds),
    );
    timeFormatters.set(key, formatter);
    return formatter;
  };
  const numericDate = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });
  const numericDateWithYear = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
  const withDate = (date: Date, time: string, nowMs: number) => {
    const formatter =
      date.getFullYear() === new Date(nowMs).getFullYear() ? numericDate : numericDateWithYear;
    return `${formatter.format(date)} ${time}`;
  };

  return {
    /** Wall-clock time without seconds, e.g. `12:34 PM`. */
    formatShortTimestamp(isoDate: string, timestampFormat: TimestampFormat): string {
      const date = parseTimestampDate(isoDate);
      if (!date) return "";
      return timeFormatter(timestampFormat, false).format(date);
    },

    /**
     * Timestamp that adds the date once it is no longer from today: today
     * `12:34 PM`, yesterday `yesterday at 12:34 PM`, older `8/13 12:34 PM`
     * (locale digit order), with the year once the calendar year differs.
     */
    formatDayAwareTimestamp(
      isoDate: string,
      timestampFormat: TimestampFormat,
      nowMs: number = Date.now(),
    ): string {
      const date = parseTimestampDate(isoDate);
      if (!date) return "";
      const time = timeFormatter(timestampFormat, false).format(date);
      const daysAgo = -calendarDayDiff(date, nowMs);
      if (daysAgo <= 0) return time;
      if (daysAgo === 1) return `yesterday at ${time}`;
      return withDate(date, time, nowMs);
    },

    /**
     * The forward-looking counterpart for an instant that has not happened yet
     * (a usage-limit reset): today `12:34 PM`, tomorrow `tomorrow at 12:34 PM`,
     * later `8/13 12:34 PM`.
     */
    formatUpcomingTimestamp(
      isoDate: string,
      timestampFormat: TimestampFormat,
      nowMs: number = Date.now(),
    ): string {
      const date = parseTimestampDate(isoDate);
      if (!date) return "";
      const time = timeFormatter(timestampFormat, false).format(date);
      const daysAhead = calendarDayDiff(date, nowMs);
      if (daysAhead <= 0) return time;
      if (daysAhead === 1) return `tomorrow at ${time}`;
      return withDate(date, time, nowMs);
    },
  };
}
