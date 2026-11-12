/**
 * "Parked" in the sidebar footer and its list (board 4, F7). Each thought can
 * start a thread, go into the composer on screen, or be deleted with Undo.
 * Parked thoughts stay in this browser until they sync through the server, and
 * the list says so ("browser", not "device": the desktop app and a browser on
 * one machine hold different lists).
 */
import { scopedProjectKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import { InboxIcon, TrashIcon, XIcon } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useParkedActions } from "../../hooks/useParkedActions";
import { useClientSettings } from "../../hooks/useSettings";
import {
  firstThingSource,
  formatParkedWhen,
  localDateKey,
  removeParkedEntry,
  selectFirstThing,
  selectParkedThoughts,
  useCaptureBarStore,
} from "../../parkedThoughts";
import { usePromptStashStore, type PromptStashEntry } from "../../promptStashStore";
import { useProjects } from "../../state/entities";
import { formatShortTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogPopup, DialogTitle } from "../ui/dialog";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";

/** Parked thoughts in list order, on the minute clock so a day change re-sorts them. */
function useParkedThoughts(): ReadonlyArray<PromptStashEntry> {
  const entries = usePromptStashStore((store) => store.entries);
  const nowMinute = useNowMinute();
  const today = localDateKey(Date.parse(`${nowMinute}:00.000Z`));
  return useMemo(() => selectParkedThoughts(entries, today), [entries, today]);
}

export const SidebarParked = memo(function SidebarParked() {
  const open = useCaptureBarStore((store) => store.listOpen);
  const setOpen = useCaptureBarStore((store) => store.setListOpen);
  const thoughts = useParkedThoughts();
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
            <ParkedList
              thoughts={thoughts}
              onDone={() => setOpen(false)}
              closeButton={
                <PopoverClose render={CLOSE_BUTTON}>
                  <XIcon aria-hidden />
                </PopoverClose>
              }
            />
          </PopoverPopup>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
});

const CLOSE_BUTTON = <Button size="icon-sm" variant="ghost" aria-label="Close" />;

/**
 * The same list as a dialog, opened from the command palette, so Parked stays
 * reachable in focus mode and with the sidebar collapsed.
 */
export function ParkedListDialogHost() {
  const open = useCaptureBarStore((store) => store.listDialogOpen);
  const setOpen = useCaptureBarStore((store) => store.setListDialogOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open ? <ParkedListDialog onDone={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function ParkedListDialog({ onDone }: { onDone: () => void }) {
  const thoughts = useParkedThoughts();
  return (
    <DialogPopup
      showCloseButton={false}
      bottomStickOnMobile={false}
      viewportClassName="grid-rows-[0.6fr_auto_1fr]"
      className="max-w-100 overflow-hidden rounded-xl"
    >
      <DialogTitle className="sr-only">Parked</DialogTitle>
      <ParkedList
        thoughts={thoughts}
        onDone={onDone}
        closeButton={
          <DialogClose render={CLOSE_BUTTON}>
            <XIcon aria-hidden />
          </DialogClose>
        }
      />
    </DialogPopup>
  );
}

function ParkedList({
  thoughts,
  onDone,
  closeButton,
}: {
  thoughts: ReadonlyArray<PromptStashEntry>;
  onDone: () => void;
  closeButton: ReactElement;
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
  const today = localDateKey(nowMs);
  const firstThing = selectFirstThing(thoughts, today);
  const selected = thoughts.find((entry) => entry.id === selectedId) ?? thoughts[0] ?? null;
  // Picking a row replaces the focused button with the open row, so focus moves to its
  // first action instead of falling to the page.
  const focusOpenRowRef = useRef(false);
  const startThreadButtonRef = useCallback((element: HTMLButtonElement | null) => {
    if (!element || !focusOpenRowRef.current) return;
    focusOpenRowRef.current = false;
    element.focus();
  }, []);

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
        {/* The popover or the dialog supplies its own close control. */}
        {closeButton}
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
                  {entry === firstThing && entry.pinnedFor !== undefined ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-input px-1.5 text-[11px] leading-[14px] font-medium text-muted-foreground">
                        First thing today
                      </span>
                      <span className="grow" />
                      <span className="truncate font-mono text-[11px] leading-[14px] text-muted-foreground">
                        {firstThingSource(entry.pinnedFor, today)}
                      </span>
                    </div>
                  ) : null}
                  <p className="text-sm leading-[22px] break-words text-foreground">
                    {entry.prompt}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button
                      ref={startThreadButtonRef}
                      size="sm"
                      variant="outline"
                      className="sm:text-xs"
                      onClick={() => void use(entry, startThreadWith)}
                    >
                      Start thread
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="sm:text-xs"
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
                      <TrashIcon aria-hidden />
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
                  onClick={() => {
                    focusOpenRowRef.current = true;
                    setSelectedId(entry.id);
                  }}
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="w-full truncate text-sm leading-[22px] text-foreground">
                    {entry.prompt}
                  </span>
                  {meta ? (
                    <span className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">
                      {meta}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="h-px bg-border" />
      <p className="px-4 py-2.5 text-xs text-muted-foreground">Kept in this browser for now.</p>
    </section>
  );
}
