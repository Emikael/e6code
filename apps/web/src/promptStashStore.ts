import {
  ComposerContextRecord,
  EnvironmentId,
  ForwardCompatibleArray,
  OrchestrationParkedState,
  PARKED_IMPORT_MAX,
  PARKED_TEXT_MAX_CHARS,
  ParkedEntryId,
  ParkedImportEntry,
  ProjectId,
  ThreadId,
  type OrchestrationParkedEntry,
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
  mayParkIn,
  parkedHeldIndex,
  ParkedConsents,
  ParkedOp,
  parkedOpProblem,
  selectParkedOfferEnvironment,
  type ParkedConsent,
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
 * Each synced environment's Parked list as last received. A cache: it arrives
 * again on every connect, so it lives apart from drafts, where a large list
 * can never make a Mod+S stash fail on quota.
 */
export const PARKED_CACHE_STORAGE_KEY = "e6code:parked-cache:v1";
/** The user's answer, per environment, to saving parked thoughts and notes there. */
const PARKED_CONSENT_STORAGE_KEY = "e6code:parked-consent:v1";
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
const MAX_THREAD_NOTES = 200;

/**
 * What an entry is. Drafts are composer snapshots, thoughts come from the
 * capture bar, and notes belong to one thread's recap. Entries written before
 * kinds existed decode as drafts.
 */
export type ParkedEntryKind = "draft" | "thought" | "note";

/** The cap for each kind. Past it a new entry is refused; nothing is evicted (decision 10). */
const PARKED_CAPS: Readonly<Record<ParkedEntryKind, number>> = {
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
  /**
   * A thought or note kept here: the environment it was first offered to in
   * an upload. Fixed from then on, so it never goes to a second environment.
   */
  parkedTarget: Schema.optionalKey(Schema.String),
  /** When an upload of it was first answered. It is not counted as waiting after that. */
  sentAt: Schema.optionalKey(Schema.String),
});
export type PromptStashEntry = typeof StashEntrySchema.Type;

export const parkedEntryKind = (entry: Pick<PromptStashEntry, "kind">): ParkedEntryKind =>
  entry.kind ?? "draft";

/**
 * What this origin stores. `entries` are drafts plus any thought or note not
 * yet held by an environment. `parkedOps` are changes to synced entries not yet
 * answered by their server; they share a key with `entries` because a change
 * moves between the two in one write. `parkedServer` is each environment's
 * list as last received, kept under `PARKED_CACHE_STORAGE_KEY` (builds before
 * it kept it here, so it is still read from here once).
 */
const PersistedPromptStashState = Schema.Struct({
  entries: Schema.Array(StashEntrySchema),
  parkedOps: Schema.optionalKey(Schema.Array(ParkedOp)),
  parkedServer: Schema.optionalKey(Schema.Record(Schema.String, OrchestrationParkedState)),
});
const ParkedCache = Schema.Record(Schema.String, OrchestrationParkedState);

interface StashSnapshot {
  readonly entries: ReadonlyArray<PromptStashEntry>;
  readonly parkedOps: ReadonlyArray<ParkedOp>;
  readonly parkedServer: Readonly<Record<string, OrchestrationParkedState>>;
}

const EMPTY_SNAPSHOT: StashSnapshot = { entries: [], parkedOps: [], parkedServer: {} };

const decodePersistedPromptStashState = Schema.decodeUnknownSync(PersistedPromptStashState);
const decodeParkedCache = Schema.decodeUnknownSync(ParkedCache);
const decodeParkedConsents = Schema.decodeUnknownSync(ParkedConsents);

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
function persistSnapshot(
  snapshot: StashSnapshot,
  previous?: StashSnapshot,
): {
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
        state: { entries: snapshot.entries, parkedOps: snapshot.parkedOps },
      }),
    );
  } catch (error) {
    console.error("[PROMPT-STASH] Could not persist stash (storage quota?).", error);
    return { written: false, durable: false };
  }
  if (snapshot.parkedServer !== previous?.parkedServer) persistParkedCache(snapshot.parkedServer);
  return { written: true, durable: storageIsDurable };
}

/** Best effort: without it the list is empty until the environment sends it again. */
function persistParkedCache(cache: StashSnapshot["parkedServer"]): void {
  try {
    if (Object.keys(cache).length === 0) baseStashStorage.removeItem(PARKED_CACHE_STORAGE_KEY);
    else baseStashStorage.setItem(PARKED_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("[PROMPT-STASH] Could not keep the Parked list cache.", error);
  }
}

function readParkedCache(): StashSnapshot["parkedServer"] | null {
  try {
    const raw = baseStashStorage.getItem(PARKED_CACHE_STORAGE_KEY);
    if (typeof raw !== "string" || raw === "") return null;
    return decodeParkedCache(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readParkedConsents(): ParkedConsents {
  try {
    const raw = baseStashStorage.getItem(PARKED_CONSENT_STORAGE_KEY);
    if (typeof raw !== "string" || raw === "") return {};
    return decodeParkedConsents(JSON.parse(raw));
  } catch {
    return {};
  }
}

function persistParkedConsents(consents: ParkedConsents): boolean {
  try {
    baseStashStorage.setItem(PARKED_CONSENT_STORAGE_KEY, JSON.stringify(consents));
    return true;
  } catch (error) {
    console.error("[PROMPT-STASH] Could not keep the Parked saving choice.", error);
    return false;
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
      // Only builds before the cache had its own key wrote it here.
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
   * Where a new thought without a project goes: the primary environment,
   * once the user accepted saving there. Set by the sync coordinator.
   */
  primaryEnvironmentId: string | null;
  /** Connected environments that can hold a Parked list (`parkedSync`). Set by the sync coordinator. */
  availableEnvironmentIds: ReadonlyArray<string>;
  /**
   * The user's answer per environment. Until an environment is accepted
   * nothing parked is sent to it, new thoughts included.
   */
  consents: ParkedConsents;
  /**
   * Prepends an entry to the queue. Past its kind's cap the entry is refused
   * and nothing changes: parked work is never evicted silently. A thought
   * whose environment was accepted goes there; anything else stays on this
   * device.
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
   * thought or note kept on this device for that environment that it now
   * holds is forgotten here: that is the acknowledgement of its upload.
   */
  receiveParkedList: (environmentId: string, state: OrchestrationParkedState) => void;
  /**
   * An upload of entries kept here is about to go (`sending`: each is bound to
   * this environment for good) or was answered (`answered`).
   */
  markParkedUpload: (
    environmentId: string,
    entryIds: ReadonlyArray<string>,
    phase: "sending" | "answered",
  ) => void;
  /**
   * The server answered a queued change, or the change could never be sent
   * (`refused` with the reason). Nothing the user wrote is lost to a refusal:
   * its text is kept on this device. Returns what to tell the user, if anything.
   */
  settleParkedOp: (
    opId: string,
    outcome: "accepted" | "refused",
    reason?: string,
  ) => ParkedNotice | null;
  setPrimaryEnvironmentId: (environmentId: string | null) => void;
  setAvailableEnvironmentIds: (environmentIds: ReadonlyArray<string>) => void;
  /** Save parked thoughts and notes to this environment from now on. */
  acceptParkedSync: (environmentId: string) => WriteResult;
  /**
   * Keep everything in this browser for this environment. Anything this
   * browser was showing from it is copied here first, so nothing disappears,
   * and nothing more is sent there.
   */
  declineParkedSync: (environmentId: string) => WriteResult;
  /** Ask again about this environment (the user chose to, from the Parked list). */
  reopenParkedOffer: (environmentId: string) => void;
}

/** Something the user should hear about after a change was answered. */
export interface ParkedNotice {
  readonly type: "info" | "warning";
  readonly title: string;
  readonly description?: string;
}

/**
 * Every tab of the origin shares one stored state. A write re-reads it first
 * so a thought parked in another tab since this one last looked is kept, not
 * overwritten (decision 10: parked work is never lost silently). When storage
 * cannot be read, the in-memory state is the best there is. The cache of
 * server lists is this tab's own (it arrives on every connect).
 */
function latestSnapshot(inMemory: StashSnapshot): StashSnapshot {
  const stored = readPersistedSnapshot();
  return stored ? { ...stored, parkedServer: inMemory.parkedServer } : inMemory;
}

/** The snapshot at startup: the stored one with the cache from its own key. */
function hydratedSnapshot(options: { settleOrphans?: boolean } = {}): StashSnapshot | null {
  const stored = readPersistedSnapshot(options);
  if (!stored) return null;
  const cache = readParkedCache();
  return cache ? { ...stored, parkedServer: cache } : stored;
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
  const ops = opsFor(snapshot, environmentId);
  if (!server && ops.length === 0) return [];
  return applyParkedOps(server?.entries ?? [], ops);
}

/** Environments this device shows a list for: those it has a copy of, or changes queued for. */
function viewedEnvironmentIds(snapshot: StashSnapshot): ReadonlyArray<string> {
  return [
    ...new Set([
      ...Object.keys(snapshot.parkedServer),
      ...snapshot.parkedOps.map((op) => op.environmentId),
    ]),
  ];
}

function composeEntries(snapshot: StashSnapshot): ReadonlyArray<PromptStashEntry> {
  const synced = viewedEnvironmentIds(snapshot).flatMap((environmentId) =>
    environmentView(snapshot, environmentId).map((entry) =>
      serverEntryToStash(environmentId, entry),
    ),
  );
  if (synced.length === 0) return snapshot.entries;
  // A copy kept here of an entry an environment shows is listed once, from there.
  const syncedIds = new Set(synced.map((entry) => entry.id));
  const local = snapshot.entries.filter((entry) => !syncedIds.has(entry.id));
  // Merge newest first, keeping this device's own order (the order things
  // were stashed) intact among its entries.
  const ordered = synced.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const merged: PromptStashEntry[] = [];
  let localIndex = 0;
  let remote = 0;
  while (localIndex < local.length || remote < ordered.length) {
    const fromLocal = local[localIndex];
    const fromRemote = ordered[remote];
    if (fromLocal && (!fromRemote || fromLocal.createdAt >= fromRemote.createdAt)) {
      merged.push(fromLocal);
      localIndex += 1;
    } else if (fromRemote) {
      merged.push(fromRemote);
      remote += 1;
    }
  }
  return merged;
}

/**
 * The environment a thought or note kept here belongs in: the one it was
 * bound to by an upload, else a note's thread's environment, a thought's
 * project's environment, or for a thought without a project the primary one.
 * Null for drafts. Whether anything may go there is a separate question
 * (`mayParkIn`).
 */
function parkedEntryHome(
  entry: Pick<PromptStashEntry, "kind" | "projectKey" | "threadKey" | "parkedTarget">,
  primaryEnvironmentId: string | null,
): string | null {
  const kind = parkedEntryKind(entry);
  if (kind === "draft") return null;
  if (entry.parkedTarget !== undefined) return entry.parkedTarget;
  if (kind === "note") {
    return entry.threadKey ? (parseScopedThreadKey(entry.threadKey)?.environmentId ?? null) : null;
  }
  if (entry.projectKey) return parseScopedProjectKey(entry.projectKey)?.environmentId ?? null;
  return primaryEnvironmentId;
}

const PIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isParkedImportEntry = Schema.is(ParkedImportEntry);

/** A kept entry as one item of an upload, or null when it cannot be sent (too long, say). */
function toImportEntry(entry: PromptStashEntry, environmentId: string): ParkedImportEntry | null {
  const kind = parkedEntryKind(entry);
  if (kind === "draft") return null;
  const thread = entry.threadKey ? parseScopedThreadKey(entry.threadKey) : null;
  const candidate = {
    id: ParkedEntryId.make(entry.id),
    kind,
    text: entry.prompt.trim(),
    projectId: kind === "thought" ? projectIdIn(entry.projectKey, environmentId) : null,
    threadId: kind === "note" && thread ? ThreadId.make(thread.threadId) : null,
    pinnedFor:
      kind === "thought" && entry.pinnedFor && PIN_DATE.test(entry.pinnedFor)
        ? entry.pinnedFor
        : null,
    createdAt: entry.createdAt,
    ...(entry.sentAt ? { sentAt: entry.sentAt } : {}),
  };
  return isParkedImportEntry(candidate) ? candidate : null;
}

/**
 * Thoughts and notes kept on this device that `environmentId` should hold,
 * as one upload; empty until the user accepted that environment. The server
 * keeps one copy however often it is sent.
 */
function selectParkedImport(
  snapshot: Pick<StashSnapshot, "entries">,
  environmentId: string,
  context: { readonly consents: ParkedConsents; readonly primaryEnvironmentId: string | null },
): ReadonlyArray<ParkedImportEntry> {
  if (!mayParkIn(context.consents, environmentId)) return [];
  const upload: ParkedImportEntry[] = [];
  for (const entry of snapshot.entries) {
    if (parkedEntryHome(entry, context.primaryEnvironmentId) !== environmentId) continue;
    const item = toImportEntry(entry, environmentId);
    if (item) upload.push(item);
  }
  // One command carries at most what both caps allow; the rest goes next time.
  return upload.slice(0, PARKED_IMPORT_MAX);
}

/**
 * What the sync coordinator sends next to a connected, accepted environment:
 * first what this device kept before and never uploaded, then its queued
 * changes in order, then, once the queue is empty, one more try for entries
 * an earlier upload did not land (the environment was full, say). Each upload
 * goes once per session (`uploadedIds`). Null when there is nothing to send.
 */
export function selectNextParkedSend(
  state: Pick<
    PromptStashStoreState,
    "stored" | "consents" | "primaryEnvironmentId" | "availableEnvironmentIds"
  >,
  environmentId: string,
  uploadedIds: ReadonlySet<string>,
):
  | { readonly kind: "import"; readonly entries: ReadonlyArray<ParkedImportEntry> }
  | { readonly kind: "op"; readonly op: ParkedOp }
  | null {
  if (!mayParkIn(state.consents, environmentId)) return null;
  if (!state.availableEnvironmentIds.includes(environmentId)) return null;
  const entries = selectParkedImport(state.stored, environmentId, state).filter(
    (entry) => !uploadedIds.has(entry.id),
  );
  const fresh = entries.filter((entry) => entry.sentAt === undefined);
  if (fresh.length > 0) return { kind: "import", entries: fresh };
  const op = state.stored.parkedOps.find((candidate) => candidate.environmentId === environmentId);
  if (op) return { kind: "op", op };
  return entries.length > 0 ? { kind: "import", entries } : null;
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

/** Joins two versions of a note, as the server does, keeping both texts. */
function joinNoteTexts(current: string, incoming: string): string {
  return current.includes(incoming) ? current : `${current}\n\n${incoming}`;
}

const KEPT_HERE = "It is kept in this browser.";

export const usePromptStashStore = create<PromptStashStoreState>()((set, get) => {
  /** Persists `next` and shows it; a failed write changes nothing on screen. */
  const commit = (next: StashSnapshot): WriteResult => {
    const result = persistSnapshot(next, get().stored);
    if (result.written) set({ stored: next, entries: composeEntries(next) });
    return result;
  };
  /** Shows what storage holds now without writing (nothing to change). */
  const refresh = (snapshot: StashSnapshot) =>
    set({ stored: snapshot, entries: composeEntries(snapshot) });
  const queue = (snapshot: StashSnapshot, op: ParkedOp): StashSnapshot => ({
    ...snapshot,
    parkedOps: enqueueParkedOp(snapshot.parkedOps, op),
  });
  /** The accepted environment an entry goes to now, or null to keep it here. */
  const syncTarget = (
    entry: Pick<PromptStashEntry, "kind" | "projectKey" | "threadKey" | "parkedTarget">,
  ): string | null => {
    const home = parkedEntryHome(entry, get().primaryEnvironmentId);
    return mayParkIn(get().consents, home) ? home : null;
  };
  const setConsent = (environmentId: string, consent: ParkedConsent | null) => {
    const { [environmentId]: _previous, ...rest } = readParkedConsents();
    const consents = consent === null ? rest : { ...rest, [environmentId]: consent };
    const written = persistParkedConsents(consents);
    set({ consents });
    return written;
  };

  /** Adds a thought: to its accepted environment's queue, else to this device. */
  const addThought = (
    snapshot: StashSnapshot,
    entry: PromptStashEntry,
  ): { next: StashSnapshot } | { refused: true } => {
    const environmentId = syncTarget(entry);
    const text = entry.prompt.trim();
    // Too long to send: kept here rather than queued where it would be refused.
    if (environmentId === null || text.length > PARKED_TEXT_MAX_CHARS) {
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
        text,
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
    availableEnvironmentIds: [],
    consents: readParkedConsents(),
    setPrimaryEnvironmentId: (primaryEnvironmentId) => set({ primaryEnvironmentId }),
    setAvailableEnvironmentIds: (availableEnvironmentIds) => set({ availableEnvironmentIds }),
    acceptParkedSync: (environmentId) => {
      const written = setConsent(environmentId, "accepted");
      return { written, durable: written && storageIsDurable };
    },
    reopenParkedOffer: (environmentId) => {
      setConsent(environmentId, null);
    },
    declineParkedSync: (environmentId) => {
      const snapshot = latestSnapshot(get().stored);
      const now = new Date().toISOString();
      const env = EnvironmentId.make(environmentId);
      const entries = [...snapshot.entries];
      const localIds = new Set(entries.map((entry) => entry.id));
      for (const entry of environmentView(snapshot, environmentId)) {
        if (entry.kind === "thought") {
          if (localIds.has(entry.id)) continue;
          entries.push({
            ...serverEntryToStash(environmentId, entry),
            parkedTarget: environmentId,
            sentAt: now,
          });
          continue;
        }
        if (!entry.threadId) continue;
        const threadKey = scopedThreadKey(scopeThreadRef(env, entry.threadId));
        const index = entries.findIndex(
          (candidate) => parkedEntryKind(candidate) === "note" && candidate.threadKey === threadKey,
        );
        const existing = index === -1 ? undefined : entries[index];
        const note: PromptStashEntry = {
          id: existing?.id ?? randomUUID(),
          createdAt: entry.updatedAt,
          prompt: existing ? joinNoteTexts(entry.text, existing.prompt) : entry.text,
          attachments: [],
          droppedImageNames: [],
          kind: "note",
          threadKey,
          parkedTarget: environmentId,
          sentAt: now,
        };
        if (existing) entries[index] = note;
        else entries.push(note);
      }
      // Copied here before anything is forgotten: the choice is kept only if the copy is.
      const { [environmentId]: _dropped, ...parkedServer } = snapshot.parkedServer;
      const result = commit({
        entries: entries.map((entry) => {
          const { environmentId: _env, updatedAt: _updated, ...rest } = entry;
          return rest;
        }),
        parkedOps: snapshot.parkedOps.filter((op) => op.environmentId !== environmentId),
        parkedServer,
      });
      if (result.written) setConsent(environmentId, "declined");
      return result;
    },
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
      const environmentId = thread ? syncTarget({ kind: "note", threadKey }) : null;
      const localNote = snapshot.entries.find(
        (entry) => parkedEntryKind(entry) === "note" && entry.threadKey === threadKey,
      );
      if (environmentId !== null && thread && trimmed.length <= PARKED_TEXT_MAX_CHARS) {
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
        // Nothing to clear there: the only copy was the one kept here.
        if (!existing && trimmed.length === 0) return { refused: false, ...commit(withoutLocal) };
        // The edit starts from the note the user was shown (`selectThreadNote`).
        const shown = localNote?.prompt ?? existing?.text ?? null;
        return {
          refused: false,
          ...commit(
            queue(withoutLocal, {
              kind: "note",
              opId: newOpId(),
              environmentId,
              threadId: ThreadId.make(thread.threadId),
              text: trimmed,
              baseUpdatedAt: serverNote?.updatedAt ?? null,
              baseText: shown,
              createdAt: new Date().toISOString(),
            }),
          ),
        };
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
                ...(localNote?.parkedTarget ? { parkedTarget: localNote.parkedTarget } : {}),
              },
              ...rest,
            ];
      return { refused: false, ...commit({ ...snapshot, entries }) };
    },
    setPinnedThought: (pinnedFor, text, projectKey) => {
      const snapshot = latestSnapshot(get().stored);
      const trimmed = text.trim();
      const existing = selectFirstPinned(composeEntries(snapshot), pinnedFor);
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
      const { durable } = persistSnapshot(next, get().stored);
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
      const { durable } = persistSnapshot(next, get().stored);
      refresh(next);
      return { attached: true, durable };
    },
    receiveParkedList: (environmentId, state) => {
      const snapshot = latestSnapshot(get().stored);
      const primary = get().primaryEnvironmentId;
      const held = parkedHeldIndex(state);
      const entries = snapshot.entries.filter((entry) => {
        const kind = parkedEntryKind(entry);
        if (kind === "draft") return true;
        if (parkedEntryHome(entry, primary) !== environmentId) return true;
        const thread = entry.threadKey ? parseScopedThreadKey(entry.threadKey) : null;
        return !isLocalParkedEntryHeld(
          {
            id: entry.id,
            kind,
            text: entry.prompt,
            threadId: thread ? ThreadId.make(thread.threadId) : null,
            createdAt: entry.createdAt,
          },
          held,
        );
      });
      // Persisting is best effort: the list arrives again on the next connect.
      commit({
        ...snapshot,
        entries,
        parkedServer: { ...snapshot.parkedServer, [environmentId]: state },
      });
    },
    markParkedUpload: (environmentId, entryIds, phase) => {
      const snapshot = latestSnapshot(get().stored);
      const ids = new Set(entryIds);
      const now = new Date().toISOString();
      let changed = false;
      const entries = snapshot.entries.map((entry) => {
        if (!ids.has(entry.id)) return entry;
        if (phase === "sending" && entry.parkedTarget === undefined) {
          changed = true;
          return { ...entry, parkedTarget: environmentId };
        }
        if (phase === "answered" && entry.sentAt === undefined) {
          changed = true;
          return { ...entry, sentAt: now };
        }
        return entry;
      });
      if (changed) commit({ ...snapshot, entries });
      else refresh(snapshot);
    },
    settleParkedOp: (opId, outcome, reason) => {
      const snapshot = latestSnapshot(get().stored);
      const op = snapshot.parkedOps.find((candidate) => candidate.opId === opId);
      if (!op) {
        refresh(snapshot);
        return null;
      }
      const parkedOps = snapshot.parkedOps.filter((candidate) => candidate !== op);
      const server = snapshot.parkedServer[op.environmentId];
      const env = EnvironmentId.make(op.environmentId);
      const now = new Date().toISOString();
      const description = (text: string) => (reason ? `${reason} ${text}` : text);
      let keepHere: PromptStashEntry | null = null;
      let notice: ParkedNotice | null = null;

      if (op.kind === "note") {
        const serverNote = server?.entries.find(
          (entry) => entry.kind === "note" && entry.threadId === op.threadId,
        );
        const threadKey = scopedThreadKey(scopeThreadRef(env, op.threadId));
        if (outcome === "accepted") {
          // The server joined this edit with text written elsewhere.
          if (
            op.text.length > 0 &&
            op.baseText !== undefined &&
            serverNote !== undefined &&
            serverNote.text !== op.text &&
            serverNote.text !== (op.baseText ?? "")
          ) {
            notice = {
              type: "info",
              title: "This note changed on another device. Both versions are kept.",
            };
          }
        } else if (op.text.length === 0) {
          // Gone anyway (its thread was deleted, say): nothing to tell.
          if (serverNote)
            notice = {
              type: "info",
              title: "This note changed on another device, so it was not cleared.",
            };
        } else {
          keepHere = {
            id: randomUUID(),
            createdAt: now,
            prompt: op.text,
            attachments: [],
            droppedImageNames: [],
            kind: "note",
            threadKey,
            parkedTarget: op.environmentId,
            sentAt: now,
          };
          notice = {
            type: "warning",
            title: "Could not save this note",
            description: description(KEPT_HERE),
          };
        }
      } else if (outcome === "refused" && op.kind === "add") {
        // Already there (a retried Undo, say): nothing to keep.
        if (!server?.entries.some((entry) => entry.id === op.entryId)) {
          keepHere = {
            id: op.entryId,
            createdAt: op.createdAt,
            prompt: op.text,
            attachments: [],
            droppedImageNames: [],
            kind: "thought",
            parkedTarget: op.environmentId,
            sentAt: now,
            ...(op.projectId
              ? { projectKey: scopedProjectKey(scopeProjectRef(env, op.projectId)) }
              : {}),
            ...(op.pinnedFor ? { pinnedFor: op.pinnedFor } : {}),
          };
          notice = {
            type: "warning",
            title: "Could not save this thought",
            description: description(KEPT_HERE),
          };
        }
      } else if (outcome === "refused" && op.kind === "update") {
        const current = server?.entries.find((entry) => entry.id === op.entryId);
        if (!current || current.text !== op.text || current.pinnedFor !== op.pinnedFor) {
          keepHere = {
            id: randomUUID(),
            createdAt: now,
            prompt: op.text,
            attachments: [],
            droppedImageNames: [],
            kind: "thought",
            parkedTarget: op.environmentId,
            sentAt: now,
            ...(op.pinnedFor ? { pinnedFor: op.pinnedFor } : {}),
          };
          notice = {
            type: "warning",
            title: current
              ? "Could not save this change"
              : "This thought was deleted on another device",
            description: description(`Your version is kept in this browser.`),
          };
        }
      }
      // A refused removal needs nothing: the thought is already gone there.
      const result = commit({
        ...snapshot,
        parkedOps,
        entries: keepHere ? [keepHere, ...snapshot.entries] : snapshot.entries,
      });
      return result.written ? notice : null;
    },
  };
});

/** The thought pinned for `pinnedFor`; the latest written when two devices pinned one each. */
function selectFirstPinned(
  entries: ReadonlyArray<PromptStashEntry>,
  pinnedFor: string,
): PromptStashEntry | undefined {
  let pinned: PromptStashEntry | undefined;
  for (const entry of entries) {
    if (parkedEntryKind(entry) !== "thought" || entry.pinnedFor !== pinnedFor) continue;
    if (!pinned || entry.createdAt > pinned.createdAt) pinned = entry;
  }
  return pinned;
}

/**
 * The thread's note to self, for the recap's "Your note". A copy kept here
 * (written before saving was accepted, or one the environment refused) is the
 * user's latest text, so it wins over the environment's.
 */
export function selectThreadNote(
  entries: ReadonlyArray<PromptStashEntry>,
  threadKey: string,
): PromptStashEntry | null {
  let synced: PromptStashEntry | null = null;
  for (const entry of entries) {
    if (parkedEntryKind(entry) !== "note" || entry.threadKey !== threadKey) continue;
    if (entry.environmentId === undefined) return entry;
    synced ??= entry;
  }
  return synced;
}

/**
 * An offer to save what this browser holds to an environment the user has
 * not answered for yet, with what it would upload. Null when there is none.
 */
export function selectParkedOffer(
  state: Pick<
    PromptStashStoreState,
    "stored" | "consents" | "primaryEnvironmentId" | "availableEnvironmentIds"
  >,
): { readonly environmentId: string; readonly thoughts: number; readonly notes: number } | null {
  const environmentId = selectParkedOfferEnvironment({
    consents: state.consents,
    available: state.availableEnvironmentIds,
    primaryEnvironmentId: state.primaryEnvironmentId,
  });
  if (environmentId === null) return null;
  let thoughts = 0;
  let notes = 0;
  for (const entry of state.stored.entries) {
    if (parkedEntryHome(entry, state.primaryEnvironmentId) !== environmentId) continue;
    if (!toImportEntry(entry, environmentId)) continue;
    if (parkedEntryKind(entry) === "note") notes += 1;
    else thoughts += 1;
  }
  return { environmentId, thoughts, notes };
}

/**
 * The Parked list's footer: where the list is kept. `savedOn` are the
 * accepted environments, `waiting` counts thoughts and notes that will be sent
 * to one of them that is reachable now, and `keptHere` those this browser
 * keeps for good (not accepted anywhere, too long, or refused). `saveLater`
 * and `stopSaving` are the environments the user can change their answer for.
 */
export function selectParkedFooter(
  state: Pick<
    PromptStashStoreState,
    "stored" | "consents" | "primaryEnvironmentId" | "availableEnvironmentIds"
  >,
): {
  readonly savedOn: ReadonlyArray<string>;
  readonly waiting: number;
  readonly keptHere: number;
  readonly saveLater: ReadonlyArray<string>;
} {
  const available = new Set(state.availableEnvironmentIds);
  const accepted = Object.keys(state.consents).filter((id) => mayParkIn(state.consents, id));
  const savedOn = accepted.filter((id) => available.has(id) || id in state.stored.parkedServer);
  const reachable = (environmentId: string | null) =>
    environmentId !== null &&
    mayParkIn(state.consents, environmentId) &&
    available.has(environmentId);
  let waiting = 0;
  let kept = 0;
  for (const entry of state.stored.entries) {
    if (parkedEntryKind(entry) === "draft") continue;
    const home = parkedEntryHome(entry, state.primaryEnvironmentId);
    if (
      entry.sentAt === undefined &&
      reachable(home) &&
      home !== null &&
      toImportEntry(entry, home)
    ) {
      waiting += 1;
    } else {
      kept += 1;
    }
  }
  for (const op of state.stored.parkedOps) {
    if (op.kind === "remove" || (op.kind === "note" && op.text.length === 0)) continue;
    if (reachable(op.environmentId) && parkedOpProblem(op) === null) waiting += 1;
  }
  return {
    savedOn,
    waiting,
    keptHere: savedOn.length > 0 ? kept : 0,
    saveLater: state.availableEnvironmentIds.filter((id) => state.consents[id] === "declined"),
  };
}

// Hydrate at startup, and again whenever another tab writes the list.
{
  try {
    baseStashStorage.removeItem(LEGACY_PROMPT_STASH_STORAGE_KEY);
  } catch {
    // Purging the v1 payload is best-effort; a storage policy that rejects
    // the delete must not take down module init.
  }
  const persisted = hydratedSnapshot({ settleOrphans: true });
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
  if (key === PARKED_CONSENT_STORAGE_KEY || key === null) {
    usePromptStashStore.setState({ consents: readParkedConsents() });
  }
  if (key === PARKED_CACHE_STORAGE_KEY) {
    const { stored } = usePromptStashStore.getState();
    const snapshot = { ...stored, parkedServer: readParkedCache() ?? {} };
    usePromptStashStore.setState({ stored: snapshot, entries: composeEntries(snapshot) });
    return;
  }
  if (key !== null && key !== PROMPT_STASH_STORAGE_KEY) return;
  const snapshot = hydratedSnapshot() ?? EMPTY_SNAPSHOT;
  usePromptStashStore.setState({ stored: snapshot, entries: composeEntries(snapshot) });
}

/** Test seam: what storage holds under `key`. */
export function readPromptStashStorageForTest(key: string): string | null {
  const raw = baseStashStorage.getItem(key);
  return typeof raw === "string" ? raw : null;
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
  if (raw === "") {
    baseStashStorage.removeItem(PARKED_CACHE_STORAGE_KEY);
    baseStashStorage.removeItem(PARKED_CONSENT_STORAGE_KEY);
    usePromptStashStore.setState({ consents: {}, availableEnvironmentIds: [] });
  }
  if (options.rehydrate === false) return;
  // Rehydrating here stands in for a fresh page load, so orphans settle.
  const snapshot = hydratedSnapshot({ settleOrphans: true }) ?? EMPTY_SNAPSHOT;
  usePromptStashStore.setState({ stored: snapshot, entries: composeEntries(snapshot) });
}
