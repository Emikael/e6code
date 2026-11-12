/**
 * Park it (F7): thoughts parked from the capture bar, listed in the sidebar's
 * Parked popover and as chips on the start screen. They live in
 * `promptStashStore` beside composer drafts, as entries of kind "thought", and
 * stay in this browser until parked thoughts sync through the server.
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

/**
 * The Parked list (board 4): thoughts only, newest first, with one pinned for
 * today ("First thing today") on top. Drafts come back through a composer's
 * Parked menu, and notes stay with their thread's recap.
 */
export function selectParkedThoughts(
  entries: ReadonlyArray<PromptStashEntry>,
  today: string,
): ReadonlyArray<PromptStashEntry> {
  const thoughts = entries.filter((entry) => parkedEntryKind(entry) === "thought");
  const pinned = thoughts.find((entry) => entry.pinnedFor === today);
  return pinned ? [pinned, ...thoughts.filter((entry) => entry !== pinned)] : thoughts;
}

/** Board 1's chips under the composer: up to two thoughts, then "N more". Pinned ones lead elsewhere. */
export function selectParkedChips(
  entries: ReadonlyArray<PromptStashEntry>,
  today: string,
): { readonly chips: ReadonlyArray<PromptStashEntry>; readonly more: number } {
  const thoughts = selectParkedThoughts(entries, today).filter(
    (entry) => entry.pinnedFor !== today,
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
  readonly setOpen: (open: boolean) => void;
  readonly setListOpen: (open: boolean) => void;
}>()((set) => ({
  open: false,
  listOpen: false,
  setOpen: (open) => set({ open }),
  setListOpen: (listOpen) => set({ listOpen }),
}));

export const openCaptureBar = () => useCaptureBarStore.getState().setOpen(true);

export const openParkedList = () => useCaptureBarStore.getState().setListOpen(true);
