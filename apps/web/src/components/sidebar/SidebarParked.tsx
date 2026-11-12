/**
 * "Parked" in the sidebar footer and its list (board 4, F7). Each thought can
 * start a thread, go into the composer on screen, or be deleted with Undo.
 * Parked thoughts stay in this browser until they sync through the server, and
 * the list says so.
 */
import { scopedProjectKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import { InboxIcon, Trash2Icon, XIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useParkedActions } from "../../hooks/useParkedActions";
import { useClientSettings } from "../../hooks/useSettings";
import {
  formatParkedWhen,
  localDateKey,
  removeParkedEntry,
  selectParkedThoughts,
  useCaptureBarStore,
} from "../../parkedThoughts";
import { usePromptStashStore, type PromptStashEntry } from "../../promptStashStore";
import { useProjects } from "../../state/entities";
import { formatShortTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";

export const SidebarParked = memo(function SidebarParked() {
  const entries = usePromptStashStore((store) => store.entries);
  const open = useCaptureBarStore((store) => store.listOpen);
  const setOpen = useCaptureBarStore((store) => store.setListOpen);
  const nowMinute = useNowMinute();
  const today = localDateKey(Date.parse(`${nowMinute}:00.000Z`));
  const thoughts = useMemo(() => selectParkedThoughts(entries, today), [entries, today]);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<SidebarMenuButton />}>
            <InboxIcon />
            <span className="min-w-0 flex-1 truncate">Parked</span>
            {thoughts.length > 0 ? (
              <span className="shrink-0 font-mono text-[11px] text-sidebar-muted-foreground tabular-nums">
                {thoughts.length}
              </span>
            ) : null}
          </PopoverTrigger>
          <PopoverPopup
            side="right"
            align="end"
            className="w-100"
            viewportClassName="p-0 [--viewport-inline-padding:0px]"
          >
            <ParkedList thoughts={thoughts} onDone={() => setOpen(false)} />
          </PopoverPopup>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
});

function ParkedList({
  thoughts,
  onDone,
}: {
  thoughts: ReadonlyArray<PromptStashEntry>;
  onDone: () => void;
}) {
  const { startThreadWith, putInComposer } = useParkedActions();
  const projects = useProjects();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const projectTitleByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project.title,
        ]),
      ),
    [projects],
  );
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const selected = thoughts.find((entry) => entry.id === selectedId) ?? thoughts[0] ?? null;

  // The thought leaves Parked once it has gone somewhere.
  const use = async (entry: PromptStashEntry, action: typeof startThreadWith) => {
    onDone();
    if (await action(entry.prompt, entry.projectKey)) {
      usePromptStashStore.getState().takeEntry(entry.id);
    } else {
      toastManager.add({ type: "error", title: "Add a project to start a thread" });
    }
  };
  const remove = (entry: PromptStashEntry) => {
    const removed = removeParkedEntry(entry.id);
    if (!removed) return;
    toastManager.add({
      type: "success",
      title: "Deleted",
      actionProps: {
        children: "Undo",
        onClick: () => usePromptStashStore.getState().restoreEntry(removed.entry, removed.index),
      },
    });
  };

  return (
    <section aria-label="Parked" className="flex flex-col">
      <div className="flex items-center gap-2 pt-3 pr-3 pb-2 pl-4">
        <h2 className="min-w-0 flex-1 text-sm leading-5 font-semibold text-foreground">Parked</h2>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {thoughts.length}
        </span>
        <PopoverClose render={<Button size="icon-sm" variant="ghost" aria-label="Close" />}>
          <XIcon aria-hidden />
        </PopoverClose>
      </div>
      {thoughts.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">
          Nothing parked. A thought you park lands here.
        </p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {thoughts.map((entry) => {
            const project = entry.projectKey
              ? (projectTitleByKey.get(entry.projectKey) ?? null)
              : null;
            const when = formatParkedWhen(entry.createdAt, nowMs, (iso) =>
              formatShortTimestamp(iso, timestampFormat),
            );
            const meta = [project, when].filter(Boolean).join(" · ");
            if (entry === selected) {
              return (
                <li key={entry.id} className="flex flex-col gap-2 rounded-lg bg-accent p-2.5">
                  <p className="text-sm leading-[22px] break-words text-foreground">
                    {entry.prompt}
                  </p>
                  {meta ? <span className="text-[11px] text-muted-foreground">{meta}</span> : null}
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void use(entry, startThreadWith)}
                    >
                      Start thread
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void use(entry, putInComposer)}
                    >
                      Put in composer
                    </Button>
                    <span className="grow" />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => remove(entry)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            }
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={() => setSelectedId(entry.id)}
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="w-full truncate text-sm leading-[22px] text-foreground">
                    {entry.prompt}
                  </span>
                  {meta ? <span className="text-[11px] text-muted-foreground">{meta}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="h-px bg-border" />
      <p className="px-4 py-2.5 text-xs text-muted-foreground">Kept on this device for now.</p>
    </section>
  );
}
