import { UsageDay, type UsageSummaryInput } from "@e6tools/contracts";

const DAY_MS = 24 * 60 * 60_000;

function shiftDay(day: string, delta: number): UsageDay {
  const [year = 0, month = 1, dayOfMonth = 1] = day
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  return UsageDay.make(
    new Date(Date.UTC(year, month - 1, dayOfMonth + delta)).toISOString().slice(0, 10),
  );
}

function dayIn(instantMs: number, timeZone: string): UsageDay {
  return UsageDay.make(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instantMs),
  );
}

/**
 * The equal-length window that ends where `window` starts: the 7 calendar days
 * before a 7-day window, or the 24 hours before a rolling 24-hour one.
 */
export function previousWindow(window: UsageSummaryInput): UsageSummaryInput {
  if (window.sinceTime !== undefined && window.untilTime !== undefined) {
    const sinceMs = Date.parse(window.sinceTime);
    const untilMs = Date.parse(window.untilTime);
    const previousSince = sinceMs - (untilMs - sinceMs);
    return {
      ...window,
      sinceDay: dayIn(previousSince, window.timeZone),
      untilDay: dayIn(sinceMs, window.timeZone),
      sinceTime: new Date(previousSince).toISOString(),
      untilTime: window.sinceTime,
    };
  }
  const length = Math.round((Date.parse(window.untilDay) - Date.parse(window.sinceDay)) / DAY_MS);
  return {
    ...window,
    sinceDay: shiftDay(window.sinceDay, -(length + 1)),
    untilDay: shiftDay(window.sinceDay, -1),
  };
}

/** Changes this small read as noise, so they are worded as "about the same". */
const SAME_THRESHOLD_PERCENT = 3;

/**
 * `12% more than the 7 days before`, with the direction for its icon, or null
 * when the previous window has nothing to compare against.
 */
export function describePeriodChange(
  current: number,
  previous: number,
  periodLabel: string,
): { readonly direction: "more" | "less" | "same"; readonly text: string } | null {
  if (!(previous > 0)) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(percent) <= SAME_THRESHOLD_PERCENT) {
    return { direction: "same", text: `About the same as the ${periodLabel} before` };
  }
  const direction = percent > 0 ? "more" : "less";
  return {
    direction,
    text: `${Math.abs(percent)}% ${direction} than the ${periodLabel} before`,
  };
}
