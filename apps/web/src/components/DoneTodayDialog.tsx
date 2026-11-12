/**
 * Done today and Wrap up (board 5, F9): what got finished since midnight, as a
 * plain list, and a way to close the day. Wrap up lists what is still open,
 * snoozes it until tomorrow morning with the existing snooze command, and
 * keeps one "First thing tomorrow" line, shown above the composer when you
 * come back. Nothing is totalled, scored or compared with other days.
 */
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@e6tools/client-runtime/environment";
import {
  localStartOfDayMs,
  selectDoneToday,
  withThreadsArchivedToday,
} from "@e6tools/client-runtime/state/done-today";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { canSnooze } from "@e6tools/client-runtime/state/thread-settled";
import type { ThreadAttentionItem } from "@e6tools/client-runtime/state/thread-attention";
import { useRouter } from "@tanstack/react-router";
import {
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  MessageCircleQuestionIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useId, useMemo, useState } from "react";
import { create } from "zustand";

import { useParkedActions } from "../hooks/useParkedActions";
import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { useClientSettings } from "../hooks/useSettings";
import { useThreadActions } from "../hooks/useThreadActions";
import { useThreadAttention } from "../hooks/useThreadAttention";
import { nextLocalDateKey, PARKED_INPUT_MAX_CHARS, parkedLengthCount } from "../parkedThoughts";
import { PARKED_FULL_MESSAGE, usePromptStashStore } from "../promptStashStore";
import { readEnvironmentSupportsSnooze, useProjects, useThreadShells } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatShortTimestamp, formatWeekdayDayMonth } from "../timestampFormat";
import { resolveWorkingStartedAt } from "./Sidebar.logic";
import { resolveSnoozePresets } from "./Sidebar.snooze";
import { BlockedDiamond } from "./SidebarNeedsYou";
import { selectWorkingThreads } from "./chat/DraftHeroFooter.logic";
import { doneTodayMeta, wrapUpSnoozeLabel } from "./DoneTodayDialog.logic";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogPopup, DialogTitle } from "./ui/dialog";
import { stackedThreadToast, toastManager } from "./ui/toast";

/** Whether Done today is open. The sidebar row and the palette open it. */
export const useDoneTodayStore = create<{
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

export const openDoneToday = () => useDoneTodayStore.getState().setOpen(true);

/** Root host: the one Done today dialog, mounted only while open. */
export function DoneTodayDialogHost() {
  const open = useDoneTodayStore((store) => store.open);
  const setOpen = useDoneTodayStore((store) => store.setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open ? <DoneTodayDialog onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

const TITLE_CLASS = "truncate text-[13px] leading-[18px] font-medium text-foreground";
const META_CLASS =
  "truncate font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums";

/**
 * Archived threads from each connected environment. The live shell list leaves
 * them out. Refreshed once on open, so archives from other clients show too.
 */
function useArchivedThreads(): ReadonlyArray<EnvironmentThreadShell> {
  const { environments } = useEnvironments();
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const { snapshots, refresh } = useArchivedThreadSnapshots(environmentIds);
  // Once per open, not on every reconnect.
  const refreshOnOpen = useEffectEvent(refresh);
  useEffect(() => refreshOnOpen(), []);
  return useMemo(
    () =>
      snapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.threads.map((thread) => ({ ...thread, environmentId })),
      ),
    [snapshots],
  );
}

function DoneTodayDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const threads = useThreadShells();
  const projects = useProjects();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  // The day is fixed when the dialog opens; it does not roll over while open.
  const [nowMs] = useState(() => Date.now());
  const startOfDayMs = localStartOfDayMs(nowMs);
  const archived = useArchivedThreads();
  const rows = useMemo(
    () =>
      selectDoneToday(withThreadsArchivedToday(threads, archived, { startOfDayMs }), {
        startOfDayMs,
      }),
    [archived, startOfDayMs, threads],
  );
  const projectNames = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project.title,
        ]),
      ),
    [projects],
  );
  const formatTime = (iso: string) => formatShortTimestamp(iso, timestampFormat);
  const openThread = (thread: EnvironmentThreadShell) => {
    onClose();
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };

  return (
    <DialogPopup
      showCloseButton={false}
      className="max-w-216 overflow-hidden rounded-2xl"
      aria-describedby={undefined}
    >
      <div className="flex items-center gap-3 py-3 ps-6 pe-4 pt-4">
        <DialogTitle className="text-lg leading-6 font-semibold tracking-[-0.015em]">
          Done today
        </DialogTitle>
        <span className={META_CLASS}>{formatWeekdayDayMonth(new Date(nowMs))}</span>
        <span className="grow" />
        <DialogClose
          aria-label="Close"
          render={<Button size="icon-sm" variant="ghost" className="text-muted-foreground" />}
        >
          <XIcon className="size-4" />
        </DialogClose>
      </div>
      <div className="h-px bg-border" />
      <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-6 pt-4 pb-6 md:flex-row md:items-stretch">
        {rows.length === 0 ? (
          <p className="flex-1 py-3 text-sm leading-5 text-muted-foreground">
            Nothing finished yet today.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-1 flex-col">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-start gap-3 border-border py-3 not-last:border-b"
              >
                <CheckIcon
                  role="img"
                  aria-label="Done"
                  className="mt-0.5 size-4 shrink-0 text-success-foreground"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={TITLE_CLASS}>{row.thread.title}</span>
                  <span className={META_CLASS}>
                    {doneTodayMeta(row, {
                      projectName:
                        projectNames.get(
                          scopedProjectKey(
                            scopeProjectRef(row.thread.environmentId, row.thread.projectId),
                          ),
                        ) ?? null,
                      formatTime,
                    })}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs sm:text-xs"
                  aria-label={`Open ${row.thread.title}`}
                  onClick={() => openThread(row.thread)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
        <WrapUp nowMs={nowMs} onClose={onClose} />
      </div>
    </DialogPopup>
  );
}

type StillOpen =
  | { readonly kind: "blocked"; readonly item: ThreadAttentionItem<EnvironmentThreadShell> }
  | { readonly kind: "working"; readonly key: string; readonly thread: EnvironmentThreadShell };

function WrapUp({ nowMs, onClose }: { nowMs: number; onClose: () => void }) {
  const threads = useThreadShells();
  const attention = useThreadAttention();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { snoozeThread, unsnoozeThread } = useThreadActions();
  const { currentProjectKey } = useParkedActions();
  const noteId = useId();
  const tomorrow = nextLocalDateKey(nowMs);
  const existingNote = usePromptStashStore(
    (store) =>
      store.entries.find((entry) => entry.kind === "thought" && entry.pinnedFor === tomorrow)
        ?.prompt ?? "",
  );
  const [note, setNote] = useState(existingNote);
  const [snoozed, setSnoozed] = useState(false);

  const stillOpen = useMemo<ReadonlyArray<StillOpen>>(() => {
    const working = selectWorkingThreads(threads, attention, resolveWorkingStartedAt);
    return [
      ...[...attention.blocked, ...attention.earlier].map((item) => ({
        kind: "blocked" as const,
        item,
      })),
      ...working.map((row) => ({ kind: "working" as const, key: row.key, thread: row.thread })),
    ];
  }, [attention, threads]);
  const tomorrowMorning = useMemo(
    () => resolveSnoozePresets(new Date(nowMs), timestampFormat).find((p) => p.id === "tomorrow"),
    [nowMs, timestampFormat],
  );
  // Blocked approvals and questions cannot be snoozed; they stay in Needs you.
  const snoozable = useMemo(() => {
    const now = new Date(nowMs).toISOString();
    return stillOpen
      .map((entry) => (entry.kind === "blocked" ? entry.item.thread : entry.thread))
      .filter(
        (thread) =>
          readEnvironmentSupportsSnooze(thread.environmentId) && canSnooze(thread, { now }),
      );
  }, [nowMs, stillOpen]);

  const snoozeAll = async () => {
    if (!tomorrowMorning || snoozable.length === 0) return;
    const refs = snoozable.map((thread) => scopeThreadRef(thread.environmentId, thread.id));
    const results = await Promise.all(
      refs.map((ref) => snoozeThread(ref, tomorrowMorning.snoozedUntil, { undoToast: false })),
    );
    const done = refs.filter((_, index) => results[index]?._tag === "Success");
    setSnoozed(done.length > 0);
    const toastId = toastManager.add(
      stackedThreadToast({
        type: done.length === refs.length ? "success" : "warning",
        title: `Snoozed until tomorrow ${tomorrowMorning.whenLabel}`,
        ...(done.length === refs.length
          ? {}
          : { description: `${refs.length - done.length} couldn't be snoozed.` }),
        ...(done.length > 0
          ? {
              actionProps: {
                children: "Undo",
                onClick: () => {
                  toastManager.close(toastId);
                  setSnoozed(false);
                  void Promise.all(done.map((ref) => unsnoozeThread(ref)));
                },
              },
            }
          : {}),
      }),
    );
  };

  const wrapUp = () => {
    if (note.trim() !== existingNote.trim()) {
      const result = usePromptStashStore
        .getState()
        .setPinnedThought(tomorrow, note, currentProjectKey());
      if (result.refused) {
        toastManager.add({ type: "error", title: PARKED_FULL_MESSAGE });
        return;
      }
      if (!result.written) {
        toastManager.add({
          type: "error",
          title: "Could not keep this line",
          description: "Browser storage rejected the write. Free up site data and try again.",
        });
        return;
      }
    }
    onClose();
  };

  return (
    <aside
      aria-label="Wrap up"
      className="flex shrink-0 flex-col gap-3.5 rounded-xl border bg-surface-raised p-4 md:w-80"
    >
      <h2 className="text-sm leading-5 font-semibold text-foreground">Wrap up</h2>
      {stillOpen.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs leading-4 text-muted-foreground">Still open</span>
          {stillOpen.map((entry) =>
            entry.kind === "blocked" ? (
              <StillOpenRow
                key={entry.item.key}
                title={entry.item.thread.title}
                kind={entry.item.kind}
              />
            ) : (
              <StillOpenRow key={entry.key} title={entry.thread.title} kind="working" />
            ),
          )}
          {snoozable.length > 0 && tomorrowMorning && !snoozed ? (
            <Button
              size="sm"
              variant="outline"
              className="max-w-full self-start text-xs sm:text-xs"
              onClick={() => void snoozeAll()}
            >
              <ClockIcon aria-hidden className="size-3.5" />
              <span className="truncate">
                {wrapUpSnoozeLabel({
                  snoozable: snoozable.map((thread) => thread.title),
                  listedCount: stillOpen.length,
                  whenLabel: tomorrowMorning.whenLabel,
                })}
              </span>
            </Button>
          ) : null}
        </div>
      ) : null}
      {stillOpen.length > 0 ? <div className="h-px bg-border" /> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className={TITLE_CLASS}>
          First thing tomorrow
        </label>
        <textarea
          id={noteId}
          rows={3}
          value={note}
          maxLength={PARKED_INPUT_MAX_CHARS}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby={`${noteId}-hint`}
          className="w-full resize-none rounded-lg border border-input bg-card px-2.5 py-2 text-sm leading-[22px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span id={`${noteId}-hint`} className="text-xs leading-4 text-muted-foreground">
          Shown above the composer when you come back.
          {parkedLengthCount(note.length) ? ` ${parkedLengthCount(note.length)}` : null}
        </span>
      </div>
      <span className="grow" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="text-[13px] sm:text-[13px]" onClick={onClose}>
          Not now
        </Button>
        <Button className="text-[13px] sm:text-[13px]" onClick={wrapUp}>
          Wrap up
        </Button>
      </div>
    </aside>
  );
}

const STILL_OPEN_STATUS = {
  approval: "Needs approval",
  input: "Needs your answer",
  failed: "Failed",
  working: "Working",
} as const;

function StillOpenRow({
  title,
  kind,
}: {
  title: string;
  kind: "approval" | "input" | "failed" | "plan" | "done" | "working";
}) {
  if (kind === "plan" || kind === "done") return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="inline-flex w-4 shrink-0 justify-center">
        {kind === "approval" ? (
          <BlockedDiamond />
        ) : kind === "input" ? (
          <MessageCircleQuestionIcon aria-hidden className="size-3.5 text-warning-foreground" />
        ) : kind === "failed" ? (
          <CircleAlertIcon aria-hidden className="size-3.5 text-destructive-foreground" />
        ) : (
          <span
            aria-hidden
            className="size-2 rounded-full bg-primary ring-3 ring-primary-surface"
          />
        )}
      </span>
      <span className={`${TITLE_CLASS} min-w-0 flex-1`}>{title}</span>
      <span
        className={
          kind === "working"
            ? "shrink-0 text-xs leading-4 font-medium text-primary-text"
            : kind === "failed"
              ? "shrink-0 text-xs leading-4 font-medium text-destructive-foreground"
              : "shrink-0 text-xs leading-4 font-medium text-warning-foreground"
        }
      >
        {STILL_OPEN_STATUS[kind]}
      </span>
    </div>
  );
}
