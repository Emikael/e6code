/**
 * The open-thread reminder (board 7, F12): one muted line in a new thread's
 * composer once the setting's number of threads are open. It is information,
 * never a gate: Send is not blocked or delayed. "See them" moves focus to the
 * thread list.
 */
import {
  countOpenThreads,
  openThreadReminderText,
} from "@e6tools/client-runtime/state/thread-attention";
import { memo, useMemo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShells } from "~/state/entities";
import { useOptionalSidebar } from "../ui/sidebar";

export const OpenThreadReminder = memo(function OpenThreadReminder() {
  const threshold = useClientSettings((settings) => settings.openThreadReminderAt);
  const threads = useThreadShells();
  // Snoozes wake on the clock; the minute is enough for a whole-thread count.
  const nowMinute = useNowMinute();
  const text = useMemo(
    () =>
      threshold === "off"
        ? null
        : openThreadReminderText(
            countOpenThreads(threads, { now: `${nowMinute}:00.000Z` }),
            threshold,
          ),
    [nowMinute, threads, threshold],
  );
  const sidebar = useOptionalSidebar();
  if (!text) return null;
  const seeThem = () => {
    if (sidebar) {
      if (sidebar.isMobile) sidebar.setOpenMobile(true);
      else sidebar.setOpen(true);
    }
    // After the sidebar opens, focus its first thread row.
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("[data-thread-item] :is(a[href], button, [tabindex='0'])")
        ?.focus();
    });
  };
  return (
    <p className="flex items-center gap-2 px-1 pb-2 text-xs leading-4 text-muted-foreground">
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        className="shrink-0 cursor-pointer rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(event) => event.preventDefault()}
        onClick={seeThem}
      >
        See them
      </button>
    </p>
  );
});
