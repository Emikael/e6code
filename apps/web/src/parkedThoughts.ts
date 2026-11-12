/**
 * Park it (F7): thoughts parked from the capture bar, listed in the sidebar's
 * Parked popover and as chips on the start screen. They live in
 * `promptStashStore` beside composer drafts, as entries of kind "thought".
 * An environment with `parkedSync` holds them (phase 20); otherwise they stay
 * on this device.
 */
import { create } from "zustand";

import {
  PARKED_FULL_MESSAGE,
  parkedEntryKind,
  usePromptStashStore,
  type PromptStashEntry,
} from "./promptStashStore";
import { randomUUID } from "./lib/utils";

/** Start screen chips before "N more" (board 1). */
export const PARKED_CHIP_LIMIT = 2;

/** "2026-11-12" in local time, the shape of `pinnedFor`. */
export function localDateKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The `localDateKey` of the day after `ms`, for "First thing tomorrow". */
export function nextLocalDateKey(ms: number): string {
  const date = new Date(ms);
  date.setDate(date.getDate() + 1);
  return localDateKey(date.getTime());
}

/**
 * "First thing today" (boards 1 and 5): the thought Wrap up pinned for today,
 * or for the latest earlier day if you were away then, so it still greets the
 * next time you come back. Dismissing it unpins it. Null when there is none.
 */
export function selectFirstThing(
  entries: ReadonlyArray<PromptStashEntry>,
  today: string,
): PromptStashEntry | null {
  let first: PromptStashEntry | null = null;
  for (const entry of entries) {
    if (parkedEntryKind(entry) !== "thought" || entry.pinnedFor === undefined) continue;
    if (entry.pinnedFor > today) continue;
    if (!first || entry.pinnedFor > (first.pinnedFor ?? "")) first = entry;
  }
  return first;
}

/**
 * Where the "First thing today" thought came from, under its badge in the
 * Parked list (board 4): "from yesterday's wrap up", or the weekday of the
 * wrap up when you were away longer. Wrap up pins a line for the next day.
 */
export function firstThingSource(pinnedFor: string, today: string): string {
  const [year, month, day] = pinnedFor.split("-").map(Number);
  const wrappedOn = new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) - 1);
  if (pinnedFor === today) return "from yesterday's wrap up";
  const weekday = wrappedOn.toLocaleDateString("en-US", { weekday: "long" });
  return `from ${weekday}'s wrap up`;
}

/**
 * The Parked list (board 4): thoughts only, newest first, with the "First
 * thing today" one on top. Drafts come back through a composer's Parked
 * menu, and notes stay with their thread's recap.
 */
export function selectParkedThoughts(
  entries: ReadonlyArray<PromptStashEntry>,
  today: string,
): ReadonlyArray<PromptStashEntry> {
  const thoughts = entries.filter((entry) => parkedEntryKind(entry) === "thought");
  const pinned = selectFirstThing(thoughts, today);
  return pinned ? [pinned, ...thoughts.filter((entry) => entry !== pinned)] : thoughts;
}

/**
 * Board 1's chips under the composer: up to two thoughts, then "N more".
 * "First thing today" has its own card above the composer, and a thought
 * pinned for a later day waits for it.
 */
export function selectParkedChips(
  entries: ReadonlyArray<PromptStashEntry>,
  today: string,
): { readonly chips: ReadonlyArray<PromptStashEntry>; readonly more: number } {
  const first = selectFirstThing(entries, today);
  const thoughts = selectParkedThoughts(entries, today).filter(
    (entry) => entry !== first && !(entry.pinnedFor !== undefined && entry.pinnedFor > today),
  );
  return {
    chips: thoughts.slice(0, PARKED_CHIP_LIMIT),
    more: Math.max(0, thoughts.length - PARKED_CHIP_LIMIT),
  };
}

/**
 * "14:09" today, "Tue" within the week, else "Nov 3": when it was parked, in
 * the Parked list's meta line beside the project.
 */
export function formatParkedWhen(
  createdAt: string,
  nowMs: number,
  formatClock: (iso: string) => string,
): string {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return "";
  if (localDateKey(createdMs) === localDateKey(nowMs)) return formatClock(createdAt);
  const date = new Date(createdMs);
  const withinWeek = nowMs - createdMs < 6 * 24 * 60 * 60 * 1_000;
  return date.toLocaleDateString(
    undefined,
    withinWeek ? { weekday: "short" } : { month: "short", day: "numeric" },
  );
}

export type ParkResult =
  | { readonly kind: "parked"; readonly entry: PromptStashEntry; readonly durable: boolean }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "failed" };

/** Parks a one-line thought; refused when Parked is full, never evicting another. */
export function parkThought(text: string, projectKey: string | null): ParkResult {
  const prompt = text.trim();
  const entry: PromptStashEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    prompt,
    attachments: [],
    droppedImageNames: [],
    kind: "thought",
    ...(projectKey ? { projectKey } : {}),
  };
  const result = usePromptStashStore.getState().stashEntry(entry);
  if (result.refused) return { kind: "refused", message: PARKED_FULL_MESSAGE };
  if (!result.written) return { kind: "failed" };
  return { kind: "parked", entry, durable: result.durable };
}

/** Removes a thought and returns what Undo needs to put it back in place. */
export function removeParkedEntry(
  entryId: string,
): { readonly entry: PromptStashEntry; readonly index: number } | null {
  const store = usePromptStashStore.getState();
  const index = store.entries.findIndex((entry) => entry.id === entryId);
  const { entry } = store.takeEntry(entryId);
  return entry ? { entry, index } : null;
}

/**
 * Whether the capture bar and the Parked list are open. Any surface can open
 * them; the root host renders the bar and the sidebar footer owns the list.
 */
export const useCaptureBarStore = create<{
  readonly open: boolean;
  readonly listOpen: boolean;
  /** The list as a dialog, for when the sidebar is out of reach (focus, collapsed). */
  readonly listDialogOpen: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly setListOpen: (open: boolean) => void;
  readonly setListDialogOpen: (open: boolean) => void;
}>()((set) => ({
  open: false,
  listOpen: false,
  listDialogOpen: false,
  setOpen: (open) => set({ open }),
  setListOpen: (listOpen) => set({ listOpen }),
  setListDialogOpen: (listDialogOpen) => set({ listDialogOpen }),
}));

export const openCaptureBar = () => useCaptureBarStore.getState().setOpen(true);

export const openParkedList = () => useCaptureBarStore.getState().setListOpen(true);

/** The Parked list as a dialog (command palette), reachable without the sidebar. */
export const openParkedListDialog = () => useCaptureBarStore.getState().setListDialogOpen(true);

/**
 * The Parked list's footer: where the list is kept, said plainly. While no
 * environment holds it, it is this browser's (board 4 says "device", but the
 * desktop app and a browser on one machine keep different lists); once one
 * does, it names where.
 */
export function parkedHomeLine(
  home: "device" | "synced" | "uploading",
  environmentLabels: ReadonlyArray<string>,
): string {
  const where = environmentLabels.length === 1 ? environmentLabels[0] : "your environments";
  switch (home) {
    case "device":
      return "Kept in this browser for now.";
    case "synced":
      return `Saved on ${where}, so your other devices see it too.`;
    case "uploading":
      return "Some are still in this browser, waiting to be saved.";
  }
}
