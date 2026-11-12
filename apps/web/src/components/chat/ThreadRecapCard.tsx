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
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadRecapStore } from "~/threadRecapStore";
import { formatShortTimestamp } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

export interface ThreadRecapSource {
  readonly messages: ReadonlyArray<RecapMessage>;
  readonly workLogEntries: ReadonlyArray<WorkLogEntry>;
  readonly checkpoints: ReadonlyArray<RecapCheckpoint>;
  readonly provider: string;
  readonly activityCount: number;
}

/** The previous visit: when you last had the thread open, else the sidebar's visit stamp. */
function readPreviousVisit(threadKey: string): string | null {
  return (
    useThreadRecapStore.getState().lastSeenAtByKey[threadKey] ??
    useUiStateStore.getState().threadLastVisitedAtById[threadKey] ??
    null
  );
}

interface RecapHostState {
  readonly threadKey: string;
  readonly previousVisitAt: string | null;
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
  onOpenFile,
  onOpenChanges,
}: {
  threadKey: string;
  /** False while thread detail loads; the recap waits so it sees the whole log. */
  ready: boolean;
  source: ThreadRecapSource;
  onOpenMessage: (messageId: string) => void;
  onOpenFile: (turnId: string, path: string) => void;
  onOpenChanges: () => void;
}) {
  const trigger = useClientSettings((settings) => settings.recapTrigger);
  const nowMinute = useNowMinute();
  const recapRequest = useThreadRecapStore((store) => store.recapRequest);
  const noteSeen = useThreadRecapStore((store) => store.noteSeen);
  const [state, setState] = useState<RecapHostState>(() => ({
    threadKey,
    previousVisitAt: readPreviousVisit(threadKey),
    recap: undefined,
    handledRequest: recapRequest?.nonce ?? 0,
  }));

  // A new thread starts over, reading its previous visit before this one is recorded.
  let current = state;
  if (current.threadKey !== threadKey) {
    current = {
      threadKey,
      previousVisitAt: readPreviousVisit(threadKey),
      recap: undefined,
      handledRequest: recapRequest?.nonce ?? 0,
    };
    setState(current);
  }

  if (ready && current.recap === undefined) {
    const latestActivityAt = latestThreadActivityAt(source);
    const show = shouldShowThreadRecap({
      trigger,
      previousVisitAt: current.previousVisitAt,
      latestActivityAt,
      // Minute precision is plenty for a five-minute break.
      nowMs: Date.parse(`${nowMinute}:00.000Z`),
    });
    const recap =
      show && current.previousVisitAt !== null
        ? deriveThreadRecap({ ...source, since: current.previousVisitAt, note: null })
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
    const since =
      current.previousVisitAt ??
      source.messages.find((message) => message.role === "user")?.createdAt ??
      null;
    const recap = since ? deriveThreadRecap({ ...source, since, note: null }) : null;
    if (recap === null) {
      toastManager.add({ type: "info", title: "Nothing to recap in this thread yet" });
    }
    current = { ...current, recap, handledRequest: recapRequest.nonce };
    setState(current);
  }

  // This visit counts from now until you leave the thread or the page.
  useEffect(() => {
    const record = () => noteSeen(threadKey, new Date().toISOString());
    record();
    window.addEventListener("pagehide", record);
    return () => {
      window.removeEventListener("pagehide", record);
      record();
    };
  }, [noteSeen, threadKey]);

  if (!current.recap) return null;
  return (
    <ThreadRecapCard
      recap={current.recap}
      onDismiss={() => setState({ ...current, recap: null })}
      onOpenMessage={onOpenMessage}
      onOpenFile={onOpenFile}
      onOpenChanges={onOpenChanges}
    />
  );
}

const ROW_CLASS = "grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-3";
const KEY_CLASS = "text-xs leading-4 font-medium text-muted-foreground";
const LINK_CLASS =
  "cursor-pointer rounded-sm text-left underline decoration-input underline-offset-3 outline-none hover:decoration-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

function ThreadRecapCard({
  recap,
  onDismiss,
  onOpenMessage,
  onOpenFile,
  onOpenChanges,
}: {
  recap: ThreadRecap;
  onDismiss: () => void;
  onOpenMessage: (messageId: string) => void;
  onOpenFile: (turnId: string, path: string) => void;
  onOpenChanges: () => void;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { youAsked, sinceThen, note } = recap;
  return (
    <section
      aria-label="Where you left off"
      className="mb-2.5 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3.5"
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm leading-5 font-semibold text-foreground">
          Where you left off
        </h2>
        <span className="shrink-0 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground tabular-nums">
          changed since {formatShortTimestamp(recap.since, timestampFormat)}
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
            {sinceThen.summary ? (
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
      {note ? (
        <div className={ROW_CLASS}>
          <span className={KEY_CLASS}>Your note</span>
          <span className="text-sm leading-[22px] text-foreground">{note}</span>
        </div>
      ) : null}
      {sinceThen && sinceThen.files.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="sm:text-xs" onClick={onOpenChanges}>
            Changes so far
          </Button>
        </div>
      ) : null}
    </section>
  );
}
