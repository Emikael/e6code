/**
 * "First thing today" above the start screen's composer (board 1): the line
 * you left yourself in Wrap up. Start thread puts it in this composer and
 * takes it out of Parked; dismissing unpins it and leaves it in Parked.
 */
import { XIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useParkedActions } from "~/hooks/useParkedActions";
import { localDateKey, selectFirstThing } from "~/parkedThoughts";
import { usePromptStashStore } from "~/promptStashStore";
import { Button } from "../ui/button";

export const FirstThingTodayCard = memo(function FirstThingTodayCard() {
  const entries = usePromptStashStore((store) => store.entries);
  const nowMinute = useNowMinute();
  // The minute clock reads "2026-11-11T14:02" in UTC.
  const today = localDateKey(Date.parse(`${nowMinute}:00.000Z`));
  const entry = useMemo(() => selectFirstThing(entries, today), [entries, today]);
  const { putInComposer } = useParkedActions();
  if (!entry) return null;
  return (
    <section
      aria-label="First thing today"
      className="flex flex-wrap items-center gap-2.5 rounded-xl border bg-surface-raised py-2 ps-3.5 pe-2"
    >
      <span className="inline-flex h-5 shrink-0 items-center rounded-md border border-input px-1.5 text-[11px] leading-[14px] font-medium text-muted-foreground">
        First thing today
      </span>
      <p className="min-w-0 flex-1 basis-60 truncate text-sm leading-5 text-foreground">
        {entry.prompt}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void putInComposer(entry.prompt, entry.projectKey).then((placed) => {
            if (placed) usePromptStashStore.getState().takeEntry(entry.id);
          });
        }}
      >
        Start thread
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Dismiss"
        className="text-muted-foreground"
        onClick={() => usePromptStashStore.getState().unpinEntry(entry.id)}
      >
        <XIcon className="size-4" />
      </Button>
    </section>
  );
});
