import { applyParkedOps, type ParkedOp } from "@e6tools/client-runtime/parked-sync";
import {
  EnvironmentId,
  PARKED_NOTES_MAX,
  PARKED_TEXT_MAX_CHARS,
  PARKED_THOUGHTS_MAX,
  type ThreadId,
  type OrchestrationParkedEntry,
  type OrchestrationParkedState,
} from "@e6tools/contracts";

/** One parked thought on the mobile Parked screen. */
export interface ParkedRow {
  readonly environmentId: EnvironmentId;
  readonly entry: OrchestrationParkedEntry;
  /** Parked or changed on this phone and not answered by the environment yet. */
  readonly waiting: boolean;
}

/**
 * The thoughts of every environment the user accepted, with this phone's
 * unsent changes applied, newest first. An environment whose list has not
 * arrived (offline) still shows what this phone queued for it. Notes stay
 * with their thread, as on the web.
 */
export function buildParkedRows(
  lists: ReadonlyMap<EnvironmentId, OrchestrationParkedState>,
  ops: ReadonlyArray<ParkedOp>,
  acceptedEnvironmentIds: ReadonlyArray<string> = [...lists.keys()],
): ReadonlyArray<ParkedRow> {
  const rows: ParkedRow[] = [];
  for (const id of acceptedEnvironmentIds) {
    const environmentId = EnvironmentId.make(id);
    const envOps = ops.filter((op) => op.environmentId === environmentId);
    const waiting = new Set(
      envOps.flatMap((op) => (op.kind === "add" || op.kind === "update" ? [op.entryId] : [])),
    );
    const view = applyParkedOps(lists.get(environmentId)?.entries ?? [], envOps);
    for (const entry of view) {
      if (entry.kind === "thought") {
        rows.push({ environmentId, entry, waiting: waiting.has(entry.id) });
      }
    }
  }
  return [...rows].sort(
    (left, right) =>
      right.entry.createdAt.localeCompare(left.entry.createdAt) ||
      right.entry.id.localeCompare(left.entry.id),
  );
}

/**
 * Where a new thought goes: the environment the user picked among those they
 * accepted, else the first accepted one by name. Null until one is accepted.
 */
export function parkedTarget(
  accepted: ReadonlyArray<{ readonly environmentId: string; readonly label: string }>,
  picked: string | null,
): string | null {
  if (picked !== null && accepted.some((environment) => environment.environmentId === picked)) {
    return picked;
  }
  return (
    [...accepted].sort((left, right) => left.label.localeCompare(right.label))[0]?.environmentId ??
    null
  );
}

/**
 * The project a new thought is filed under: the one picked (from a thread,
 * that thread's), while it belongs to the environment the thought goes to;
 * otherwise none, since a project lives in one environment.
 */
export function parkedProjectFor(
  projects: ReadonlyArray<{ readonly environmentId: string; readonly id: string }>,
  environmentId: string | null,
  projectId: string | null,
): string | null {
  if (environmentId === null || projectId === null) return null;
  return projects.some(
    (project) => project.environmentId === environmentId && project.id === projectId,
  )
    ? projectId
    : null;
}

export const PARKED_FULL_MESSAGE = "Parked is full. Remove one to add another.";

/** Whether `environmentId` can take another thought; past the cap it is refused, never evicted. */
export function canParkIn(rows: ReadonlyArray<ParkedRow>, environmentId: EnvironmentId): boolean {
  return rows.filter((row) => row.environmentId === environmentId).length < PARKED_THOUGHTS_MAX;
}

/** "812 / 1,000" once the text nears the cap, else null. */
export function parkedLengthCount(length: number): string | null {
  return length >= PARKED_TEXT_MAX_CHARS * 0.8
    ? `${length.toLocaleString("en-US")} / ${PARKED_TEXT_MAX_CHARS.toLocaleString("en-US")}`
    : null;
}

/** "14:09" today, else the short date: when it was parked. */
export function formatParkedTime(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  const sameDay = created.toDateString() === now.toDateString();
  return sameDay
    ? created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The environment's entries with this phone's unsent changes for it applied. */
function environmentView(
  lists: ReadonlyMap<EnvironmentId, OrchestrationParkedState>,
  ops: ReadonlyArray<ParkedOp>,
  environmentId: EnvironmentId,
) {
  return applyParkedOps(
    lists.get(environmentId)?.entries ?? [],
    ops.filter((op) => op.environmentId === environmentId),
  );
}

const isNoteFor = (threadId: ThreadId) => (entry: OrchestrationParkedEntry) =>
  entry.kind === "note" && entry.threadId === threadId;

/** The thread's note to self, with this phone's unsent edits applied; null when it has none. */
export function threadNoteText(
  lists: ReadonlyMap<EnvironmentId, OrchestrationParkedState>,
  ops: ReadonlyArray<ParkedOp>,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): string | null {
  return environmentView(lists, ops, environmentId).find(isNoteFor(threadId))?.text ?? null;
}

export const THREAD_NOTES_FULL_MESSAGE =
  "You have 200 thread notes. Clear one in its thread's recap, or delete an old thread, to add another.";

/**
 * What saving `text` as the thread's note means: nothing when it is the note
 * already shown (or empty with no note), a refusal when a new note would pass
 * the cap, else the change to queue. Empty text clears the note. The change
 * starts from the note the user was shown, so the server can keep both
 * versions when another device changed it meanwhile.
 */
export function threadNoteChange(input: {
  readonly lists: ReadonlyMap<EnvironmentId, OrchestrationParkedState>;
  readonly ops: ReadonlyArray<ParkedOp>;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly opId: string;
  readonly now: string;
}):
  | { readonly kind: "unchanged" }
  | { readonly kind: "full" }
  | { readonly kind: "save"; readonly op: ParkedOp } {
  const view = environmentView(input.lists, input.ops, input.environmentId);
  const shown = view.find(isNoteFor(input.threadId))?.text ?? null;
  const text = input.text.trim();
  if (text === (shown ?? "")) return { kind: "unchanged" };
  if (shown === null && view.filter((entry) => entry.kind === "note").length >= PARKED_NOTES_MAX) {
    return { kind: "full" };
  }
  const saved = input.lists.get(input.environmentId)?.entries.find(isNoteFor(input.threadId));
  return {
    kind: "save",
    op: {
      kind: "note",
      opId: input.opId,
      environmentId: input.environmentId,
      threadId: input.threadId,
      text,
      baseUpdatedAt: saved?.updatedAt ?? null,
      baseText: shown,
      createdAt: input.now,
    },
  };
}
