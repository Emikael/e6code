import {
  ComposerContextRecord,
  EnvironmentId,
  ForwardCompatibleArray,
  OrchestrationParkedState,
  PARKED_IMPORT_MAX,
  ParkedEntryId,
  ProjectId,
  ThreadId,
  type OrchestrationParkedEntry,
  type ParkedImportEntry,
} from "@e6tools/contracts";
import {
  parseScopedProjectKey,
  parseScopedThreadKey,
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@e6tools/client-runtime/environment";
import {
  applyParkedOps,
  enqueueParkedOp,
  isLocalParkedEntryHeld,
  ParkedOp,
} from "@e6tools/client-runtime/parked-sync";
import * as Schema from "effect/Schema";
import { create } from "zustand";

import {
  PersistedComposerFileAttachment,
  PersistedComposerImageAttachment,
} from "./composerDraftStore";
import { createMemoryStorage, type StateStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export const PROMPT_STASH_STORAGE_KEY = "e6code:prompt-stash:v2";
/**
 * v1 bucketed entries into per-provider-instance queues and stored a model
 * selection with each prompt. The stash is provider-agnostic now, so the old
 * payload is deleted at startup rather than migrated — left behind it would
 * silently hold megabytes of the origin's ~5MB localStorage quota forever.
 */
const LEGACY_PROMPT_STASH_STORAGE_KEY = "e6code:prompt-stash:v1";
const PROMPT_STASH_STORAGE_VERSION = 2;

/** Drafts parked from a composer (Mod+S), which can carry images. */
export const MAX_STASH_ENTRIES = 20;
/** Text-only thoughts parked from the capture bar (Mod+Alt+P). */
export const MAX_PARKED_THOUGHTS = 200;
/** Notes to self, one per thread, shown in the recap. */
export const MAX_THREAD_NOTES = 200;

/**
 * What an entry is. Drafts are composer snapshots, thoughts come from the
 * capture bar, and notes belong to one thread's recap. Entries written before
 * kinds existed decode as drafts.
 */
export type ParkedEntryKind = "draft" | "thought" | "note";

/** The cap for each kind. Past it a new entry is refused; nothing is evicted (decision 10). */
export const PARKED_CAPS: Readonly<Record<ParkedEntryKind, number>> = {
  draft: MAX_STASH_ENTRIES,
  thought: MAX_PARKED_THOUGHTS,
  note: MAX_THREAD_NOTES,
};

export const PARKED_FULL_MESSAGE = "Parked is full. Remove one to add another.";
/** Notes are listed only in their own thread's recap, so the way out names that. */
export const THREAD_NOTES_FULL_MESSAGE =
  "You have 200 thread notes. Clear one in its thread's recap, or delete an old thread, to add another.";
/**
 * Budget for an entry's serialized attachment payload. localStorage is a
 * ~5MB origin-wide quota shared with the composer draft store, so oversized
 * images are dropped (tracked in `droppedImageNames`) rather than persisted.
 *
 * Sized to hold two images at the per-image compression budget
 * (`MAX_STASH_IMAGE_DATA_URL_CHARS`) so a typical before/after screenshot
 * pair survives intact.
 */
export const MAX_STASH_ENTRY_ATTACHMENT_CHARS = 2_700_000;

/**
 * Stashed files keep signed-upload references instead of storing their bytes.
 * Image payloads remain subject to the localStorage budget.
 */
const StashEntrySchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  prompt: Schema.String,
  attachments: Schema.Array(PersistedComposerImageAttachment),
  files: Schema.optionalKey(Schema.Array(PersistedComposerFileAttachment)),
  /** Names of images that exceeded the attachment budget and were not saved. */
  droppedImageNames: Schema.Array(Schema.String),
  /**
   * Names of images that could not be decoded or re-encoded at all — a
   * distinct failure from exceeding the size budget, so the menu can explain
   * which actually happened. Optional: entries written before this field
   * existed decode without it.
   */
  unreadableImageNames: Schema.optionalKey(Schema.Array(Schema.String)),
  /**
   * Images still being encoded when the entry was written. The entry is
   * persisted before its images so a crash mid-encode cannot lose the prompt;
   * this field lets the UI show "N images still saving" until
   * `finalizeEntryImages` lands, and flags entries orphaned by a reload.
   */
  pendingImageCount: Schema.optionalKey(Schema.Number),
  /**
   * Payloads behind the prompt's context links (terminal excerpts, review comments, preview
   * annotations). Images and files have their own fields above. Optional: older entries
   * decode without it.
   */
  records: Schema.optionalKey(ForwardCompatibleArray(ComposerContextRecord)),
  /** Absent on entries from before kinds: those are drafts. */
  kind: Schema.optionalKey(Schema.Literals(["draft", "thought", "note"])),
  /** The project it was parked in (`scopedProjectKey`), for "e6code · 14:09". */
  projectKey: Schema.optionalKey(Schema.String),
  /** A note's thread (`scopedThreadKey`). */
  threadKey: Schema.optionalKey(Schema.String),
  /** A local date ("2026-11-12") on which the entry leads the start screen (wrap up, phase 14). */
  pinnedFor: Schema.optionalKey(Schema.String),
  /**
   * Set on thoughts and notes the environment holds (phase 20): the list shows
   * them from that environment's Parked list. Absent on drafts and on entries
   * kept only on this device so far.
   */
  environmentId: Schema.optionalKey(Schema.String),
  /** The server's version of a synced note, for `parked.note.set`. */
  updatedAt: Schema.optionalKey(Schema.String),
});
export type PromptStashEntry = typeof StashEntrySchema.Type;

export const parkedEntryKind = (entry: Pick<PromptStashEntry, "kind">): ParkedEntryKind =>
  entry.kind ?? "draft";

/**
 * What this origin stores. `entries` are drafts plus any thought or note not
 * yet held by an environment. `parkedOps` are changes to synced entries not yet
 * answered by their server, and `parkedServer` is each environment's list as
 * last received, so the list stays readable while the server is unreachable.
 */
const PersistedPromptStashState = Schema.Struct({
  entries: Schema.Array(StashEntrySchema),
  parkedOps: Schema.optionalKey(Schema.Array(ParkedOp)),
  parkedServer: Schema.optionalKey(Schema.Record(Schema.String, OrchestrationParkedState)),
});
type PersistedPromptStashState = typeof PersistedPromptStashState.Type;

interface StashSnapshot {
  readonly entries: ReadonlyArray<PromptStashEntry>;
  readonly parkedOps: ReadonlyArray<ParkedOp>;
  readonly parkedServer: Readonly<Record<string, OrchestrationParkedState>>;
}

const EMPTY_SNAPSHOT: StashSnapshot = { entries: [], parkedOps: [], parkedServer: {} };

const decodePersistedPromptStashState = Schema.decodeUnknownSync(PersistedPromptStashState);

/**
 * `pendingImageCount` only has meaning within the session that wrote it: the
 * encode loop that would clear it does not survive a reload. Any entry that
 * comes back from storage still pending was orphaned by a closed tab or a
 * crash mid-encode, so the count is settled here — otherwise the entry would
 * be stuck showing "saving…" and refuse to restore forever.
 *
 * The images are genuinely gone (they were never written), so they are
 * recorded as unreadable to keep the prompt itself restorable.
 */
function clearOrphanedPendingImages(
  entries: ReadonlyArray<PromptStashEntry>,
): ReadonlyArray<PromptStashEntry> {
  return entries.map((entry) => {
    if (!entry.pendingImageCount) return entry;
    const lostCount = entry.pendingImageCount;
    return {
      ...entry,
      pendingImageCount: 0,
      unreadableImageNames: [
        ...(entry.unreadableImageNames ?? []),
        ...Array.from(
          { length: lostCount },
          (_, index) => `image ${index + 1} (not saved before reload)`,
        ),
      ],
    };
  });
}

/**
 * Splits candidate attachments into a persistable set within the entry
 * budget plus the names of any that had to be dropped. Attachments are
 * admitted in order so the earliest-added images win.
 */
export function partitionStashAttachments(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): {
  kept: PersistedComposerImageAttachment[];
  droppedNames: string[];
} {
  const kept: PersistedComposerImageAttachment[] = [];
  const droppedNames: string[] = [];
  let usedChars = 0;
  for (const attachment of attachments) {
    if (usedChars + attachment.dataUrl.length > MAX_STASH_ENTRY_ATTACHMENT_CHARS) {
      droppedNames.push(attachment.name);
      continue;
    }
    usedChars += attachment.dataUrl.length;
    kept.push(attachment);
  }
  return { kept, droppedNames };
}

/**
 * Reading the `localStorage` property itself can throw `SecurityError` when
 * storage is blocked by policy or the page is a sandboxed iframe — so the
 * access has to be guarded, not just the get/set calls on it. Otherwise
 * importing this module would crash the app at load.
 *
 * `durable` is false for the in-memory fallback: writes there "succeed" but
 * vanish on reload, and callers clear the composer on the strength of a
 * successful stash, so they must be told the difference.
 */
function resolveBaseStorage(): { storage: StateStorage; durable: boolean } {
  try {
    if (typeof localStorage !== "undefined") {
      return { storage: localStorage, durable: true };
    }
  } catch {
    // Fall through to the in-memory store.
  }
  return { storage: createMemoryStorage(), durable: false };
}

const { storage: baseStashStorage, durable: storageIsDurable } = resolveBaseStorage();

/**
 * Persists the queue, immediately rather than debounced. Stashing is a
 * deliberate, infrequent keystroke — not a per-character autosave — so there
 * is nothing to coalesce, and the caller clears the composer on the strength
 * of this write landing, which a debounce timer cannot honestly report.
 *
 * Returns whether the write will survive a reload: false on a quota rejection
 * or when only the in-memory fallback is available.
 */
function persistSnapshot(snapshot: StashSnapshot): {
  /** The write succeeded (possibly only into the in-memory fallback). */
  written: boolean;
  /** The write will survive a reload. */
  durable: boolean;
} {
  try {
    baseStashStorage.setItem(
      PROMPT_STASH_STORAGE_KEY,
      JSON.stringify({
        version: PROMPT_STASH_STORAGE_VERSION,
        state: snapshot,
      }),
    );
    return { written: true, durable: storageIsDurable };
  } catch (error) {
    console.error("[PROMPT-STASH] Could not persist stash (storage quota?).", error);
    return { written: false, durable: false };
  }
}

/**
 * Reads the persisted state. Null when the payload cannot be read or decoded;
 * an empty key reads as empty.
 *
 * `settleOrphans` is passed only at startup. Later re-reads (before a write,
 * on another tab's `storage` event) leave pending counts alone, because
 * another open tab may still be encoding those images.
 */
function readPersistedSnapshot(options: { settleOrphans?: boolean } = {}): StashSnapshot | null {
  try {
    const raw = baseStashStorage.getItem(PROMPT_STASH_STORAGE_KEY);
    if (raw === null || raw === "") return EMPTY_SNAPSHOT;
    if (typeof raw !== "string") return null;
    const parsed: unknown = JSON.parse(raw);
    const state = (parsed as { state?: unknown } | null)?.state;
    if (!state) return null;
    const decoded = decodePersistedPromptStashState(state);
    return {
      entries: options.settleOrphans
        ? clearOrphanedPendingImages(decoded.entries)
        : decoded.entries,
      parkedOps: decoded.parkedOps ?? [],
      parkedServer: decoded.parkedServer ?? {},
    };
  } catch {
    return null;
  }
}

type WriteResult = { written: boolean; durable: boolean };
type RefusableWriteResult = { refused: boolean } & WriteResult;

interface PromptStashStoreState {
  /**
   * Everything the UI lists: drafts, thoughts and notes kept on this device,
   * and each synced environment's Parked list with this device's unsent
   * changes applied. Newest first.
   */
  entries: ReadonlyArray<PromptStashEntry>;
  /** The stored parts `entries` is built from. */
  stored: StashSnapshot;
  /**
   * Where a new thought goes when its project names no synced environment:
   * the primary environment, once it holds a Parked list. Set by the sync
   * coordinator.
   */
  primaryEnvironmentId: string | null;
  /**
   * Prepends an entry to the queue. Past its kind's cap the entry is refused
   * and nothing changes: parked work is never evicted silently. A thought
   * whose environment holds a Parked list goes there; anything else stays on
   * this device.
   */
  stashEntry: (entry: PromptStashEntry) => {
    /** True when the kind is at its cap; nothing was written. */
    refused: boolean;
    /** False when the write failed outright (e.g. quota); nothing was kept. */
    written: boolean;
    /**
     * False when the write will not survive a reload: either it failed, or it
     * landed only in the in-memory fallback because localStorage is blocked.
     */
    durable: boolean;
  };
  /**
   * Removes and returns an entry from the queue (restore + delete).
   * `durable` is false when the removal could not be persisted, meaning a
   * reload would resurrect the entry.
   */
  takeEntry: (entryId: string) => { entry: PromptStashEntry | null; durable: boolean };
  /** Puts an entry taken earlier back where it was (Undo); refused only if storage fails. */
  restoreEntry: (entry: PromptStashEntry, index: number) => WriteResult;
  /**
   * Sets the thread's note to self, replacing the previous one; empty text
   * removes it. `refused` when a new note would pass the notes cap.
   */
  setThreadNote: (threadKey: string, text: string) => RefusableWriteResult;
  /**
   * Sets the thought pinned for `pinnedFor` (a `localDateKey`), the "First
   * thing tomorrow" line from Wrap up, replacing one already pinned for that
   * day; empty text removes it. `refused` when a new thought would pass the cap.
   */
  setPinnedThought: (
    pinnedFor: string,
    text: string,
    projectKey: string | null,
  ) => RefusableWriteResult;
  /** Leaves the thought in Parked but no longer pinned to a day. */
  unpinEntry: (entryId: string) => WriteResult;
  /**
   * Attaches the encoded images to an entry written earlier by `stashEntry`,
   * clearing its pending count. Returns attached=false when the entry is gone
   * (restored or deleted while encoding was still running) so the caller can
   * tell the user their images did not make it.
   */
  finalizeEntryImages: (
    entryId: string,
    images: {
      attachments: ReadonlyArray<PersistedComposerImageAttachment>;
      droppedImageNames: ReadonlyArray<string>;
      unreadableImageNames: ReadonlyArray<string>;
    },
  ) => { attached: boolean; durable: boolean };
  /**
   * An environment's Parked list arrived. It becomes the cached copy, and any
   * thought or note kept on this device that the environment now holds is
   * forgotten here: that is the acknowledgement of its upload.
   */
  receiveParkedList: (environmentId: string, state: OrchestrationParkedState) => void;
  /**
   * The server answered a queued change. A refused add is kept on this device
   * instead (for example when another device filled the list meanwhile), so a
   * thought is never lost to a refusal.
   */
  settleParkedOp: (opId: string, outcome: "accepted" | "refused") => void;
  setPrimaryEnvironmentId: (environmentId: string | null) => void;
}

/**
 * Every tab of the origin shares one stored state. A write re-reads it first
 * so a thought parked in another tab since this one last looked is kept, not
 * overwritten (decision 10: parked work is never lost silently). When storage
 * cannot be read, the in-memory state is the best there is.
 */
function latestSnapshot(inMemory: StashSnapshot): StashSnapshot {
  return readPersistedSnapshot() ?? inMemory;
}

/** A synced environment's entry, in the shape the UI lists. */
function serverEntryToStash(
  environmentId: string,
  entry: OrchestrationParkedEntry,
): PromptStashEntry {
  const env = EnvironmentId.make(environmentId);
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    prompt: entry.text,
    attachments: [],
    droppedImageNames: [],
    kind: entry.kind,
    environmentId,
    updatedAt: entry.updatedAt,
    ...(entry.projectId
      ? { projectKey: scopedProjectKey(scopeProjectRef(env, entry.projectId)) }
      : {}),
    ...(entry.threadId ? { threadKey: scopedThreadKey(scopeThreadRef(env, entry.threadId)) } : {}),
    ...(entry.pinnedFor ? { pinnedFor: entry.pinnedFor } : {}),
  };
}

const opsFor = (snapshot: StashSnapshot, environmentId: string) =>
  snapshot.parkedOps.filter((op) => op.environmentId === environmentId);

/** One environment's list as this device shows it: the server's, plus unsent changes. */
function environmentView(
  snapshot: StashSnapshot,
  environmentId: string,
): ReadonlyArray<OrchestrationParkedEntry> {
  const server = snapshot.parkedServer[environmentId];
  return server ? applyParkedOps(server.entries, opsFor(snapshot, environmentId)) : [];
}

function composeEntries(snapshot: StashSnapshot): ReadonlyArray<PromptStashEntry> {
  const synced = Object.keys(snapshot.parkedServer).flatMap((environmentId) =>
    environmentView(snapshot, environmentId).map((entry) =>
      serverEntryToStash(environmentId, entry),
    ),
  );
  if (synced.length === 0) return snapshot.entries;
  // Merge newest first, keeping this device's own order (the order things
  // were stashed) intact among its entries.
  const ordered = synced.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const merged: PromptStashEntry[] = [];
  let local = 0;
  let remote = 0;
  while (local < snapshot.entries.length || remote < ordered.length) {
    const fromLocal = snapshot.entries[local];
    const fromRemote = ordered[remote];
    if (fromLocal && (!fromRemote || fromLocal.createdAt >= fromRemote.createdAt)) {
      merged.push(fromLocal);
      local += 1;
    } else if (fromRemote) {
      merged.push(fromRemote);
      remote += 1;
    }
  }
  return merged;
}

/**
 * The environment that holds (or will hold) a thought or note: a note's
 * thread's environment, a thought's project's environment, else the primary
 * one. Null when that environment keeps no Parked list (not connected yet, or
 * older than this client).
 */
export function parkedTargetEnvironment(
  entry: Pick<PromptStashEntry, "kind" | "projectKey" | "threadKey">,
  syncedEnvironmentIds: ReadonlyArray<string>,
  primaryEnvironmentId: string | null,
): string | null {
  const kind = parkedEntryKind(entry);
  if (kind === "draft") return null;
  if (kind === "note") {
    const env = entry.threadKey ? parseScopedThreadKey(entry.threadKey)?.environmentId : null;
    return env && syncedEnvironmentIds.includes(env) ? env : null;
  }
  const env = entry.projectKey ? parseScopedProjectKey(entry.projectKey)?.environmentId : null;
  if (env && syncedEnvironmentIds.includes(env)) return env;
  return primaryEnvironmentId && syncedEnvironmentIds.includes(primaryEnvironmentId)
    ? primaryEnvironmentId
    : null;
}

const MAX_PARKED_TEXT_CHARS = 8_000;
const PIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Thoughts and notes kept on this device that `environmentId` should hold,
 * as one upload. The server keeps one copy however often it is sent.
 */
export function selectParkedImport(
  snapshot: Pick<StashSnapshot, "entries" | "parkedServer">,
  environmentId: string,
  primaryEnvironmentId: string | null,
): ReadonlyArray<ParkedImportEntry> {
  const synced = Object.keys(snapshot.parkedServer);
  const upload: ParkedImportEntry[] = [];
  for (const entry of snapshot.entries) {
    const kind = parkedEntryKind(entry);
    if (kind === "draft") continue;
    if (parkedTargetEnvironment(entry, synced, primaryEnvironmentId) !== environmentId) continue;
    const text = entry.prompt.trim();
    if (text.length === 0 || text.length > MAX_PARKED_TEXT_CHARS) continue;
    const thread = entry.threadKey ? parseScopedThreadKey(entry.threadKey) : null;
    upload.push({
      id: ParkedEntryId.make(entry.id),
      kind,
      text,
      projectId: kind === "thought" ? projectIdIn(entry.projectKey, environmentId) : null,
      threadId: kind === "note" && thread ? ThreadId.make(thread.threadId) : null,
      pinnedFor:
        kind === "thought" && entry.pinnedFor && PIN_DATE.test(entry.pinnedFor)
          ? entry.pinnedFor
          : null,
      createdAt: entry.createdAt,
    });
  }
  // One command carries at most what both caps allow; the rest goes next time.
  return upload.slice(0, PARKED_IMPORT_MAX);
}

function countKind(
  entries: ReadonlyArray<PromptStashEntry | OrchestrationParkedEntry>,
  kind: ParkedEntryKind,
) {
  let count = 0;
  for (const entry of entries) {
    if (("prompt" in entry ? parkedEntryKind(entry) : entry.kind) === kind) count += 1;
  }
  return count;
}

const newOpId = () => randomUUID();

/** The project of a `projectKey`, when it belongs to `environmentId`. */
function projectIdIn(projectKey: string | undefined, environmentId: string) {
  const project = projectKey ? parseScopedProjectKey(projectKey) : null;
  return project?.environmentId === environmentId ? ProjectId.make(project.projectId) : null;
}

export const usePromptStashStore = create<PromptStashStoreState>()((set, get) => {
  /** Persists `next` and shows it; a failed write changes nothing on screen. */
  const commit = (next: StashSnapshot): WriteResult => {
    const result = persistSnapshot(next);
    if (result.written) set({ stored: next, entries: composeEntries(next) });
    return result;
  };
  /** Shows what storage holds now without writing (nothing to change). */
  const refresh = (snapshot: StashSnapshot) =>
    set({ stored: snapshot, entries: composeEntries(snapshot) });
  const syncedIds = (snapshot: StashSnapshot) => Object.keys(snapshot.parkedServer);
  const queue = (snapshot: StashSnapshot, op: ParkedOp): StashSnapshot => ({
    ...snapshot,
    parkedOps: enqueueParkedOp(snapshot.parkedOps, op),
  });

  /** Adds a thought: to its environment's queue when it syncs, else to this device. */
  const addThought = (
    snapshot: StashSnapshot,
    entry: PromptStashEntry,
  ): { next: StashSnapshot } | { refused: true } => {
    const environmentId = parkedTargetEnvironment(
      entry,
      syncedIds(snapshot),
      get().primaryEnvironmentId,
    );
    if (environmentId === null) {
      if (countKind(snapshot.entries, "thought") >= MAX_PARKED_THOUGHTS) return { refused: true };
      return { next: { ...snapshot, entries: [entry, ...snapshot.entries] } };
    }
    if (countKind(environmentView(snapshot, environmentId), "thought") >= MAX_PARKED_THOUGHTS) {
      return { refused: true };
    }
    return {
      next: queue(snapshot, {
        kind: "add",
        opId: newOpId(),
        environmentId,
        entryId: ParkedEntryId.make(entry.id),
        text: entry.prompt.trim(),
        projectId: projectIdIn(entry.projectKey, environmentId),
        pinnedFor: entry.pinnedFor ?? null,
        createdAt: entry.createdAt,
      }),
    };
  };

  return {
    entries: [],
    stored: EMPTY_SNAPSHOT,
    primaryEnvironmentId: null,
    setPrimaryEnvironmentId: (primaryEnvironmentId) => set({ primaryEnvironmentId }),
    stashEntry: (entry) => {
      const snapshot = latestSnapshot(get().stored);
      const kind = parkedEntryKind(entry);
      let next: StashSnapshot;
      if (kind === "thought") {
        const added = addThought(snapshot, entry);
        if ("refused" in added) {
          refresh(snapshot);
          return { refused: true, written: false, durable: false };
        }
        next = added.next;
      } else {
        if (countKind(snapshot.entries, kind) >= PARKED_CAPS[kind]) {
          refresh(snapshot);
          return { refused: true, written: false, durable: false };
        }
        next = { ...snapshot, entries: [entry, ...snapshot.entries] };
      }
      const { written, durable } = commit(next);
      // A rejected write must not leave the entry visible either: the caller
      // keeps the composer intact on failure, so a stashed copy would
      // duplicate the prompt.
      if (!written) refresh(snapshot);
      return { refused: false, written, durable };
    },
    restoreEntry: (entry, index) => {
      const snapshot = latestSnapshot(get().stored);
      if (entry.environmentId !== undefined) {
        if (composeEntries(snapshot).some((candidate) => candidate.id === entry.id)) {
          refresh(snapshot);
          return { written: true, durable: true };
        }
        // Undo of a synced thought: add it back with the same id.
        return commit(
          queue(snapshot, {
            kind: "add",
            opId: newOpId(),
            environmentId: entry.environmentId,
            entryId: ParkedEntryId.make(entry.id),
            text: entry.prompt,
            projectId: projectIdIn(entry.projectKey, entry.environmentId),
            pinnedFor: entry.pinnedFor ?? null,
            createdAt: entry.createdAt,
          }),
        );
      }
      if (snapshot.entries.some((candidate) => candidate.id === entry.id)) {
        refresh(snapshot);
        return { written: true, durable: true };
      }
      const entries = [...snapshot.entries];
      entries.splice(Math.min(Math.max(0, index), entries.length), 0, entry);
      return commit({ ...snapshot, entries });
    },
    setThreadNote: (threadKey, text) => {
      const snapshot = latestSnapshot(get().stored);
      const trimmed = text.trim();
      const thread = parseScopedThreadKey(threadKey);
      const environmentId = thread
        ? parkedTargetEnvironment({ kind: "note", threadKey }, syncedIds(snapshot), null)
        : null;
      const localNote = snapshot.entries.find(
        (entry) => parkedEntryKind(entry) === "note" && entry.threadKey === threadKey,
      );
      if (environmentId !== null && thread) {
        const view = environmentView(snapshot, environmentId);
        const existing = view.find(
          (entry) => entry.kind === "note" && entry.threadId === thread.threadId,
        );
        if (!existing && trimmed.length === 0 && !localNote) {
          refresh(snapshot);
          return { refused: false, written: true, durable: true };
        }
        if (!existing && trimmed.length > 0 && countKind(view, "note") >= MAX_THREAD_NOTES) {
          refresh(snapshot);
          return { refused: true, written: false, durable: false };
        }
        const serverNote = snapshot.parkedServer[environmentId]?.entries.find(
          (entry) => entry.kind === "note" && entry.threadId === thread.threadId,
        );
        // The edit replaces any copy kept here: the user saw and changed it.
        const withoutLocal = localNote
          ? { ...snapshot, entries: snapshot.entries.filter((entry) => entry !== localNote) }
          : snapshot;
        const next =
          existing || trimmed.length > 0
            ? queue(withoutLocal, {
                kind: "note",
                opId: newOpId(),
                environmentId,
                threadId: ThreadId.make(thread.threadId),
                text: trimmed,
                baseUpdatedAt: serverNote?.updatedAt ?? null,
                createdAt: new Date().toISOString(),
              })
            : withoutLocal;
        return { refused: false, ...commit(next) };
      }
      const rest = snapshot.entries.filter((entry) => entry !== localNote);
      if (
        !localNote &&
        trimmed.length > 0 &&
        countKind(snapshot.entries, "note") >= MAX_THREAD_NOTES
      ) {
        refresh(snapshot);
        return { refused: true, written: false, durable: false };
      }
      const entries: PromptStashEntry[] =
        trimmed.length === 0
          ? rest
          : [
              {
                id: localNote?.id ?? randomUUID(),
                createdAt: new Date().toISOString(),
                prompt: trimmed,
                attachments: [],
                droppedImageNames: [],
                kind: "note",
                threadKey,
              },
              ...rest,
            ];
      return { refused: false, ...commit({ ...snapshot, entries }) };
    },
    setPinnedThought: (pinnedFor, text, projectKey) => {
      const snapshot = latestSnapshot(get().stored);
      const trimmed = text.trim();
      const existing = composeEntries(snapshot).find(
        (entry) => parkedEntryKind(entry) === "thought" && entry.pinnedFor === pinnedFor,
      );
      if (existing?.environmentId !== undefined && existing) {
        const entryId = ParkedEntryId.make(existing.id);
        return {
          refused: false,
          ...commit(
            queue(
              snapshot,
              trimmed.length === 0
                ? {
                    kind: "remove",
                    opId: newOpId(),
                    environmentId: existing.environmentId,
                    entryId,
                  }
                : {
                    kind: "update",
                    opId: newOpId(),
                    environmentId: existing.environmentId,
                    entryId,
                    text: trimmed,
                    pinnedFor,
                  },
            ),
          ),
        };
      }
      const rest = snapshot.entries.filter((entry) => entry.id !== existing?.id);
      if (trimmed.length === 0)
        return { refused: false, ...commit({ ...snapshot, entries: rest }) };
      const entry: PromptStashEntry = {
        id: existing?.id ?? randomUUID(),
        createdAt: new Date().toISOString(),
        prompt: trimmed,
        attachments: [],
        droppedImageNames: [],
        kind: "thought",
        pinnedFor,
        ...(projectKey ? { projectKey } : {}),
      };
      const added = addThought({ ...snapshot, entries: rest }, entry);
      if ("refused" in added) {
        refresh(snapshot);
        return { refused: true, written: false, durable: false };
      }
      return { refused: false, ...commit(added.next) };
    },
    unpinEntry: (entryId) => {
      const snapshot = latestSnapshot(get().stored);
      const synced = composeEntries(snapshot).find(
        (entry) => entry.id === entryId && entry.environmentId !== undefined,
      );
      if (synced?.environmentId !== undefined) {
        if (synced.pinnedFor === undefined) {
          refresh(snapshot);
          return { written: true, durable: true };
        }
        return commit(
          queue(snapshot, {
            kind: "update",
            opId: newOpId(),
            environmentId: synced.environmentId,
            entryId: ParkedEntryId.make(entryId),
            text: synced.prompt,
            pinnedFor: null,
          }),
        );
      }
      const index = snapshot.entries.findIndex((candidate) => candidate.id === entryId);
      const existing = index === -1 ? undefined : snapshot.entries[index];
      if (!existing || existing.pinnedFor === undefined) {
        refresh(snapshot);
        return { written: true, durable: true };
      }
      const { pinnedFor: _pinnedFor, ...unpinned } = existing;
      const entries = [...snapshot.entries];
      entries[index] = unpinned;
      return commit({ ...snapshot, entries });
    },
    takeEntry: (entryId) => {
      const snapshot = latestSnapshot(get().stored);
      const synced = composeEntries(snapshot).find(
        (entry) => entry.id === entryId && entry.environmentId !== undefined,
      );
      if (synced?.environmentId !== undefined) {
        const { durable } = commit(
          queue(snapshot, {
            kind: "remove",
            opId: newOpId(),
            environmentId: synced.environmentId,
            entryId: ParkedEntryId.make(entryId),
          }),
        );
        return { entry: synced, durable };
      }
      const entry = snapshot.entries.find((candidate) => candidate.id === entryId) ?? null;
      if (!entry) {
        refresh(snapshot);
        return { entry: null, durable: true };
      }
      const next = {
        ...snapshot,
        entries: snapshot.entries.filter((candidate) => candidate.id !== entryId),
      };
      const { durable } = persistSnapshot(next);
      refresh(next);
      return { entry, durable };
    },
    finalizeEntryImages: (entryId, images) => {
      const snapshot = latestSnapshot(get().stored);
      const index = snapshot.entries.findIndex((candidate) => candidate.id === entryId);
      const existing = index === -1 ? undefined : snapshot.entries[index];
      // Restored or deleted mid-encode: nothing to attach to.
      if (!existing) {
        refresh(snapshot);
        return { attached: false, durable: true };
      }
      const entries = [...snapshot.entries];
      entries[index] = {
        ...existing,
        attachments: images.attachments,
        droppedImageNames: images.droppedImageNames,
        unreadableImageNames: images.unreadableImageNames,
        pendingImageCount: 0,
      };
      const next = { ...snapshot, entries };
      const { durable } = persistSnapshot(next);
      refresh(next);
      return { attached: true, durable };
    },
    receiveParkedList: (environmentId, state) => {
      const snapshot = latestSnapshot(get().stored);
      const synced = [...new Set([...syncedIds(snapshot), environmentId])];
      const primary = get().primaryEnvironmentId;
      const entries = snapshot.entries.filter((entry) => {
        const kind = parkedEntryKind(entry);
        if (kind === "draft") return true;
        if (parkedTargetEnvironment(entry, synced, primary) !== environmentId) return true;
        const thread = entry.threadKey ? parseScopedThreadKey(entry.threadKey) : null;
        return !isLocalParkedEntryHeld(
          {
            id: entry.id,
            kind,
            text: entry.prompt,
            threadId: thread ? ThreadId.make(thread.threadId) : null,
          },
          state,
        );
      });
      // Persisting is best effort: the list arrives again on the next connect.
      commit({
        ...snapshot,
        entries,
        parkedServer: { ...snapshot.parkedServer, [environmentId]: state },
      });
    },
    settleParkedOp: (opId, outcome) => {
      const snapshot = latestSnapshot(get().stored);
      const op = snapshot.parkedOps.find((candidate) => candidate.opId === opId);
      if (!op) return refresh(snapshot);
      const parkedOps = snapshot.parkedOps.filter((candidate) => candidate !== op);
      const keepHere: PromptStashEntry[] =
        outcome === "refused" && op.kind === "add"
          ? [
              {
                id: op.entryId,
                createdAt: op.createdAt,
                prompt: op.text,
                attachments: [],
                droppedImageNames: [],
                kind: "thought",
                ...(op.projectId
                  ? {
                      projectKey: scopedProjectKey(
                        scopeProjectRef(EnvironmentId.make(op.environmentId), op.projectId),
                      ),
                    }
                  : {}),
                ...(op.pinnedFor ? { pinnedFor: op.pinnedFor } : {}),
              },
            ]
          : [];
      commit({ ...snapshot, parkedOps, entries: [...keepHere, ...snapshot.entries] });
    },
  };
});

/** The thread's note to self, for the recap's "Your note". */
export function selectThreadNote(
  entries: ReadonlyArray<PromptStashEntry>,
  threadKey: string,
): PromptStashEntry | null {
  return (
    entries.find((entry) => parkedEntryKind(entry) === "note" && entry.threadKey === threadKey) ??
    null
  );
}

/**
 * Where the Parked list is kept, for its footer: on this device only, on the
 * environments it syncs with, or both while an upload is still on its way.
 */
export function selectParkedHome(
  state: Pick<PromptStashStoreState, "stored">,
): "device" | "synced" | "uploading" {
  const synced = Object.keys(state.stored.parkedServer).length > 0;
  if (!synced) return "device";
  const local = state.stored.entries.some((entry) => parkedEntryKind(entry) === "thought");
  return local || state.stored.parkedOps.length > 0 ? "uploading" : "synced";
}

// Hydrate at startup, and again whenever another tab writes the list.
{
  try {
    baseStashStorage.removeItem(LEGACY_PROMPT_STASH_STORAGE_KEY);
  } catch {
    // Purging the v1 payload is best-effort; a storage policy that rejects
    // the delete must not take down module init.
  }
  const persisted = readPersistedSnapshot({ settleOrphans: true });
  if (persisted) {
    usePromptStashStore.setState({ stored: persisted, entries: composeEntries(persisted) });
  }
  if (storageIsDurable && typeof window !== "undefined") {
    window.addEventListener("storage", (event) => handlePromptStashStorageEvent(event.key));
  }
}

/**
 * Another tab wrote storage (`key` null means it cleared everything). The list
 * is re-read without settling pending images: that tab may still be encoding them.
 */
export function handlePromptStashStorageEvent(key: string | null): void {
  if (key !== null && key !== PROMPT_STASH_STORAGE_KEY) return;
  const snapshot = readPersistedSnapshot() ?? EMPTY_SNAPSHOT;
  usePromptStashStore.setState({ stored: snapshot, entries: composeEntries(snapshot) });
}

/**
 * Test seam: seeds the persisted payload through the same storage the store
 * reads and rehydrates, without needing a real `localStorage` global.
 * Pass an empty string to clear.
 */
export function writePromptStashStorageForTest(
  raw: string,
  options: { rehydrate?: boolean } = {},
): void {
  baseStashStorage.setItem(PROMPT_STASH_STORAGE_KEY, raw);
  if (options.rehydrate === false) return;
  // Rehydrating here stands in for a fresh page load, so orphans settle.
  const snapshot = readPersistedSnapshot({ settleOrphans: true }) ?? EMPTY_SNAPSHOT;
  usePromptStashStore.setState({ stored: snapshot, entries: composeEntries(snapshot) });
}
