/**
 * "Where you left off" above the composer (board 2, F4). Shown when you open
 * a thread that changed after a break; built once on open from the thread's
 * own log and then held still while the agent keeps streaming.
 */
import {
  deriveThreadRecap,
  latestThreadActivityAt,
  shouldShowThreadRecap,
  type RecapCheckpoint,
  type RecapMessage,
  type ThreadRecap,
} from "@e6tools/client-runtime/work-log/thread-recap";
import type { WorkLogEntry } from "@e6tools/client-runtime/work-log/entries";
import { PencilIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { playMoment } from "~/lib/motion";
import {
  THREAD_NOTES_FULL_MESSAGE,
  selectThreadNote,
  usePromptStashStore,
} from "~/promptStashStore";
import { PARKED_INPUT_MAX_CHARS, parkedLengthCount } from "~/parkedThoughts";
import { useThreadRecapStore } from "~/threadRecapStore";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";
import { create } from "zustand";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

export interface ThreadRecapSource {
  readonly messages: ReadonlyArray<RecapMessage>;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly checkpoints: ReadonlyArray<RecapCheckpoint>;
  readonly provider: string;
  readonly activityCount: number;
}

interface PreviousVisit {
  /** When you left, on this device's clock. */
  readonly visitAt: string | null;
  /** The newest activity you had seen then, on the server's clock. */
  readonly seenActivityAt: string | null;
}

/** The previous visit: when you last had the thread open, else the sidebar's visit stamp. */
function readPreviousVisit(threadKey: string): PreviousVisit {
  const recapState = useThreadRecapStore.getState();
  const visitAt = recapState.lastSeenAtByKey[threadKey];
  if (visitAt) {
    return { visitAt, seenActivityAt: recapState.seenActivityAtByKey[threadKey] ?? null };
  }
  // The sidebar stamps a visit with the turn's completion time: the server's clock.
  const stamped = useUiStateStore.getState().threadLastVisitedAtById[threadKey] ?? null;
  return { visitAt: stamped, seenActivityAt: stamped };
}

interface RecapHostState {
  readonly threadKey: string;
  readonly previous: PreviousVisit;
  /** Undefined until the thread detail has loaded and the recap was decided. */
  readonly recap: ThreadRecap | null | undefined;
  readonly handledRequest: number;
}

/**
 * Decides the recap for the open thread. The previous visit is read before
 * this visit is recorded; the recap is derived once when the thread detail is
 * ready and stays frozen until you leave, dismiss it, or ask again.
 */
export function ThreadRecapHost({
  threadKey,
  ready,
  source,
  onOpenMessage,
  onOpenStep,
  onOpenFile,
  onOpenChanges,
  attachedNotSent,
  hidden = false,
  onShowingChange,
}: {
  threadKey: string;
  /**
   * Another card holds the slot above the composer (the permission prompt):
   * the recap waits, undismissed, until it is free.
   */
  hidden?: boolean;
  /** Whether a recap applies now (shown or waiting), so the Next card can give way to it. */
  onShowingChange?: (showing: boolean) => void;
  /** "1 comment not sent": attached items waiting in this thread's composer, kept live. */
  attachedNotSent: string | null;
  /** False while thread detail loads; the recap waits so it sees the whole log. */
  ready: boolean;
  source: ThreadRecapSource;
  onOpenMessage: (messageId: string) => void;
  onOpenStep: (step: { readonly entryId: string; readonly turnId: string | null }) => void;
  onOpenFile: (turnId: string, path: string) => void;
  onOpenChanges: () => void;
}) {
  const trigger = useClientSettings((settings) => settings.recapTrigger);
  const recapRequest = useThreadRecapStore((store) => store.recapRequest);
  const noteSeen = useThreadRecapStore((store) => store.noteSeen);
  const [state, setState] = useState<RecapHostState>(() => ({
    threadKey,
    previous: readPreviousVisit(threadKey),
    recap: undefined,
    handledRequest: recapRequest?.nonce ?? 0,
  }));

  // A new thread starts over, reading its previous visit before this one is recorded.
  let current = state;
  if (current.threadKey !== threadKey) {
    current = {
      threadKey,
      previous: readPreviousVisit(threadKey),
      recap: undefined,
      handledRequest: recapRequest?.nonce ?? 0,
    };
    setState(current);
  }

  // The newest activity on screen, recorded as seen when you leave.
  const latestActivityAt = useMemo(() => latestThreadActivityAt(source), [source]);
  const seenActivityRef = useRef<{ threadKey: string; at: string | null } | null>(null);
  useEffect(() => {
    if (ready) seenActivityRef.current = { threadKey, at: latestActivityAt };
  }, [latestActivityAt, ready, threadKey]);

  if (ready && current.recap === undefined) {
    const { visitAt, seenActivityAt } = current.previous;
    // Decided once per visit, so the clock is read here rather than subscribed to.
    const show = shouldShowThreadRecap({
      trigger,
      previousVisitAt: visitAt,
      previousSeenActivityAt: seenActivityAt,
      latestActivityAt,
      nowMs: Date.now(),
    });
    const recap =
      show && visitAt !== null
        ? deriveThreadRecap({
            ...source,
            since: seenActivityAt ?? visitAt,
            visitedAt: visitAt,
            note: readThreadNote(threadKey),
          })
        : null;
    current = { ...current, recap };
    setState(current);
  }

  // "Where was I?" from the palette: show it now, whatever the setting says.
  if (
    ready &&
    recapRequest !== null &&
    recapRequest.key === threadKey &&
    recapRequest.nonce !== current.handledRequest
  ) {
    const { visitAt, seenActivityAt } = current.previous;
    const since =
      seenActivityAt ??
      visitAt ??
      source.messages.find((message) => message.role === "user")?.createdAt ??
      null;
    const recap = since
      ? deriveThreadRecap({
          ...source,
          since,
          visitedAt: visitAt ?? since,
          note: readThreadNote(threadKey),
        })
      : null;
    if (recap === null) {
      toastManager.add({ type: "info", title: "Nothing to recap in this thread yet" });
    }
    current = { ...current, recap, handledRequest: recapRequest.nonce };
    setState(current);
  }

  // This visit counts from now until you leave the thread or the page.
  useEffect(() => {
    const record = () => {
      const seen = seenActivityRef.current;
      noteSeen(threadKey, new Date().toISOString(), seen?.threadKey === threadKey ? seen.at : null);
    };
    record();
    window.addEventListener("pagehide", record);
    return () => {
      window.removeEventListener("pagehide", record);
      record();
    };
  }, [noteSeen, threadKey]);

  const showing = Boolean(current.recap);
  useEffect(() => {
    onShowingChange?.(showing);
  }, [onShowingChange, showing]);
  useEffect(() => () => onShowingChange?.(false), [onShowingChange]);

  const noteDialog = <ThreadNoteDialog threadKey={threadKey} />;
  if (!current.recap || hidden) return noteDialog;
  return (
    <>
      {noteDialog}
      {/* A recap for another thread, or one asked for again, arrives as a new card. */}
      <ThreadRecapCard
        key={`${threadKey}:${current.handledRequest}`}
        threadKey={threadKey}
        recap={current.recap}
        onDismiss={() => setState({ ...current, recap: null })}
        onOpenMessage={onOpenMessage}
        onOpenStep={onOpenStep}
        onOpenFile={onOpenFile}
        onOpenChanges={onOpenChanges}
        attachedNotSent={attachedNotSent}
      />
    </>
  );
}

const ROW_CLASS = "grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-3";
const KEY_CLASS = "text-xs leading-4 font-medium text-muted-foreground";
const LINK_CLASS =
  "cursor-pointer rounded-sm text-left underline decoration-input underline-offset-3 outline-none hover:decoration-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** The thread's note to self, kept with parked thoughts in this browser. */
const readThreadNote = (threadKey: string) =>
  selectThreadNote(usePromptStashStore.getState().entries, threadKey)?.prompt ?? null;

/** Saves a note to self (empty removes it), saying so when storage refuses it. */
function saveThreadNote(threadKey: string, text: string) {
  const result = usePromptStashStore.getState().setThreadNote(threadKey, text);
  if (result.refused) toastManager.add({ type: "error", title: THREAD_NOTES_FULL_MESSAGE });
  else if (!result.written) toastManager.add({ type: "error", title: "Could not save the note" });
}

const useNoteRequest = create<{ readonly threadKey: string | null }>(() => ({ threadKey: null }));

/**
 * Opens the note-to-self editor for a thread, from the thread header's More
 * menu or the command palette: the recap is not the only way in, since it
 * can be set to Never.
 */
export function requestThreadNote(threadKey: string) {
  useNoteRequest.setState({ threadKey });
}

/** "Add note to self" or "Edit note", for the thread's menus. */
export function useThreadNoteActionLabel(threadKey: string | null): string {
  const hasNote = usePromptStashStore((store) =>
    threadKey === null ? false : selectThreadNote(store.entries, threadKey) !== null,
  );
  return hasNote ? "Edit note" : "Add note to self";
}

function ThreadNoteDialog({ threadKey }: { threadKey: string }) {
  const requested = useNoteRequest((state) => state.threadKey === threadKey);
  const close = () => useNoteRequest.setState({ threadKey: null });
  return (
    <Dialog open={requested} onOpenChange={(open) => (open ? undefined : close())}>
      {requested ? (
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Note to self</DialogTitle>
            <DialogDescription>
              For when you come back. It shows in this thread's recap.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <NoteEditor
              id={`thread-note-${threadKey}`}
              initial={readThreadNote(threadKey) ?? ""}
              onDone={(text) => {
                close();
                if (text !== null) saveThreadNote(threadKey, text);
              }}
            />
          </DialogPanel>
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}

/** One line for a note to self: Enter saves (empty removes it), Escape keeps the old one. */
function NoteEditor({
  id,
  initial,
  onDone,
}: {
  id: string;
  initial: string;
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  const lengthCount = parkedLengthCount(text.length);
  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(text);
      }}
    >
      <input
        id={id}
        autoFocus
        autoComplete="off"
        value={text}
        maxLength={PARKED_INPUT_MAX_CHARS}
        aria-describedby={lengthCount ? `${id}-count` : undefined}
        placeholder="A note for when you come back"
        className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm text-foreground ring-1 ring-muted-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone(null);
          }
        }}
      />
      {lengthCount ? (
        <span
          id={`${id}-count`}
          className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          {lengthCount}
        </span>
      ) : null}
      <Button type="submit" size="sm" variant="outline" className="sm:text-xs">
        Save
      </Button>
    </form>
  );
}

function ThreadRecapCard({
  threadKey,
  recap,
  onDismiss,
  onOpenMessage,
  onOpenStep,
  onOpenFile,
  onOpenChanges,
  attachedNotSent,
}: {
  threadKey: string;
  recap: ThreadRecap;
  attachedNotSent: string | null;
  onDismiss: () => void;
  onOpenMessage: (messageId: string) => void;
  onOpenStep: (step: { readonly entryId: string; readonly turnId: string | null }) => void;
  onOpenFile: (turnId: string, path: string) => void;
  onOpenChanges: () => void;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { youAsked, sinceThen } = recap;
  // The note is yours, so it stays live while the rest of the recap holds still.
  const note = usePromptStashStore(
    (store) => selectThreadNote(store.entries, threadKey)?.prompt ?? null,
  );
  const [editingNote, setEditingNote] = useState(false);
  // Board 10: a recap arrives by rising 6px into place; dismissing it is instant.
  const cardRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const motion = playMoment(cardRef.current, "rise");
    return () => motion?.cancel();
  }, []);
  return (
    <section
      ref={cardRef}
      aria-label="Where you left off"
      className="mb-2.5 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3.5"
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm leading-5 font-semibold text-foreground">
          Where you left off
        </h2>
        <span className="shrink-0 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground tabular-nums">
          changed since {formatDayAwareTimestamp(recap.since, timestampFormat)}
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Dismiss recap" onClick={onDismiss}>
          <XIcon aria-hidden />
        </Button>
      </div>
      {youAsked ? (
        <div className={ROW_CLASS}>
          <span className={KEY_CLASS}>You asked</span>
          <button
            type="button"
            className={`${LINK_CLASS} line-clamp-2 text-sm leading-[22px] text-foreground`}
            onClick={() => onOpenMessage(youAsked.messageId)}
          >
            {youAsked.text}
          </button>
        </div>
      ) : null}
      {sinceThen ? (
        <div className={ROW_CLASS}>
          <span className={KEY_CLASS}>Since then</span>
          <span className="flex min-w-0 flex-col gap-1">
            {sinceThen.summary && sinceThen.firstStep ? (
              <button
                type="button"
                className={`${LINK_CLASS} text-sm leading-[22px] text-foreground`}
                onClick={() => onOpenStep(sinceThen.firstStep!)}
              >
                {sinceThen.summary}
              </button>
            ) : sinceThen.summary ? (
              <span className="text-sm leading-[22px] text-foreground">{sinceThen.summary}</span>
            ) : null}
            {sinceThen.files.length > 0 ? (
              <span className="font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">
                {sinceThen.files.map((file, index) => (
                  <span key={file.path}>
                    {index > 0 ? " · " : null}
                    <button
                      type="button"
                      className={LINK_CLASS}
                      onClick={() => onOpenFile(file.turnId, file.path)}
                    >
                      {fileName(file.path)}
                    </button>{" "}
                    +{file.additions} −{file.deletions}
                  </span>
                ))}
                {sinceThen.moreFiles > 0 ? ` · +${sinceThen.moreFiles} more` : null}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
      {attachedNotSent !== null ? (
        <div className={ROW_CLASS}>
          <span className={KEY_CLASS}>Attached</span>
          <span className="text-sm leading-[22px] text-foreground">{attachedNotSent}</span>
        </div>
      ) : null}
      {editingNote ? (
        <div className={ROW_CLASS}>
          <label htmlFor={`recap-note-${threadKey}`} className={KEY_CLASS}>
            Your note
          </label>
          <NoteEditor
            id={`recap-note-${threadKey}`}
            initial={note ?? ""}
            onDone={(text) => {
              setEditingNote(false);
              if (text !== null) saveThreadNote(threadKey, text);
            }}
          />
        </div>
      ) : note ? (
        <div className={ROW_CLASS}>
          <span className={KEY_CLASS}>Your note</span>
          <span className="text-sm leading-[22px] break-words text-foreground">{note}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {sinceThen && sinceThen.files.length > 0 ? (
          <Button size="sm" variant="outline" className="sm:text-xs" onClick={onOpenChanges}>
            Changes so far
          </Button>
        ) : null}
        {editingNote ? null : (
          <Button
            size="sm"
            variant="ghost"
            className="sm:text-xs"
            onClick={() => setEditingNote(true)}
          >
            <PencilIcon aria-hidden />
            {note ? "Edit note" : "Add note"}
          </Button>
        )}
      </div>
    </section>
  );
}
