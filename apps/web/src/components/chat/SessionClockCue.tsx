/**
 * The header's session clock and break reminder (board 7). With the clock on it
 * is a quiet "Session 1h 30m"; once the reminder is due it becomes one still
 * line with "Remind me in 30m" and a dismiss button. It never opens a dialog,
 * never takes focus and never announces itself.
 */
import { ClockIcon, XIcon } from "lucide-react";
import { useEffect } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import {
  BREAK_SNOOZE_MINUTES,
  ensureSessionTracking,
  formatSessionLength,
  isBreakReminderDue,
  quietSessionReminder,
  useSessionClockStore,
} from "~/sessionClock";
import { Button } from "../ui/button";

export function SessionClockCue({ className }: { className?: string }) {
  const clockEnabled = useClientSettings((settings) => settings.sessionClockEnabled);
  const reminderMinutes = useClientSettings((settings) => settings.breakReminderMinutes);
  const active = clockEnabled || reminderMinutes !== "off";
  useEffect(() => {
    if (active) ensureSessionTracking();
  }, [active]);
  if (!active) return null;
  return (
    <SessionClockLine
      clockEnabled={clockEnabled}
      reminderMinutes={reminderMinutes}
      className={className}
    />
  );
}

function SessionClockLine({
  clockEnabled,
  reminderMinutes,
  className,
}: {
  clockEnabled: boolean;
  reminderMinutes: number | "off";
  className: string | undefined;
}) {
  const session = useSessionClockStore((store) => store.session);
  // The minute clock is the only tick: the line changes once a minute at most.
  const nowMinute = useNowMinute();
  if (!session) return null;
  const nowMs = Math.max(Date.parse(`${nowMinute}:00.000Z`), session.startedAt);
  const due = isBreakReminderDue(session, reminderMinutes, nowMs);
  const length = formatSessionLength(session.startedAt, nowMs);
  if (due) {
    return (
      <div
        className={cn(
          "flex h-8 shrink-0 items-center gap-2.5 rounded-lg border border-border bg-surface-raised ps-3 pe-1",
          className,
        )}
      >
        <ClockIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-[13px] leading-[18px] font-medium whitespace-nowrap text-foreground tabular-nums">
          {length}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 sm:h-6 sm:text-xs"
          onClick={() => quietSessionReminder(BREAK_SNOOZE_MINUTES)}
        >
          Remind me in {BREAK_SNOOZE_MINUTES}m
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Dismiss break reminder"
          onClick={() =>
            quietSessionReminder(typeof reminderMinutes === "number" ? reminderMinutes : 0)
          }
        >
          <XIcon aria-hidden />
        </Button>
      </div>
    );
  }
  if (!clockEnabled) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums",
        className,
      )}
    >
      <ClockIcon aria-hidden className="size-3.5 shrink-0" />
      {length}
    </span>
  );
}
