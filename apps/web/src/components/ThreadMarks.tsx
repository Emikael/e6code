import type { EnvironmentId, ThreadId } from "@e6tools/contracts";
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import {
  nextThreadMarks,
  parseThreadMark,
  type ThreadMarkProgress,
} from "@e6tools/shared/threadMarks";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useThreadStatus } from "../state/entities";

/**
 * Marks the first frame a routed thread shows its own rows and the first frame
 * it is live with rows (`e6:thread:*`), for the web performance harness. Mount
 * it keyed by the routed thread so every visit marks afresh. It follows the
 * thread's status only until both marks are set; after that it renders nothing
 * and subscribes to nothing, so streaming costs it nothing.
 */
export const ThreadMarks = memo(function ThreadMarks({
  environmentId,
  threadId,
  hasRows,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Whether the timeline shows this thread's rows, not another thread's held ones. */
  readonly hasRows: boolean;
}) {
  const [watching, setWatching] = useState(true);
  // Owned here, not by the watcher: the watcher unmounts once both marks are scheduled and
  // those must still land, while leaving the thread cancels any that have not.
  const [pending] = useState(() => new Set<() => void>());
  useEffect(
    () => () => {
      for (const cancel of pending) cancel();
      pending.clear();
    },
    [pending],
  );
  const schedule = useCallback((name: string) => markAfterNextFrame(name, pending), [pending]);
  const stopWatching = useCallback(() => setWatching(false), []);
  return watching ? (
    <ThreadMarksWatcher
      environmentId={environmentId}
      threadId={threadId}
      hasRows={hasRows}
      schedule={schedule}
      onDone={stopWatching}
    />
  ) : null;
});

function ThreadMarksWatcher({
  environmentId,
  threadId,
  hasRows,
  schedule,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly hasRows: boolean;
  readonly schedule: (name: string) => void;
  readonly onDone: () => void;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const status = useThreadStatus(threadRef);
  const marked = useRef<ThreadMarkProgress>({ rows: false, live: false });
  useEffect(() => {
    for (const name of nextThreadMarks({ status, hasRows, marked: marked.current })) {
      marked.current =
        parseThreadMark(name)?.kind === "live"
          ? { ...marked.current, live: true }
          : { ...marked.current, rows: true };
      schedule(name);
    }
    if (marked.current.rows && marked.current.live) onDone();
  }, [status, hasRows, schedule, onDone]);
  return null;
}

/** Stamps once the frame that shows the change has been produced; cancellable until then. */
function markAfterNextFrame(name: string, pending: Set<() => void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    cancelAnimationFrame(frame);
    if (timeout !== undefined) clearTimeout(timeout);
  };
  const frame = requestAnimationFrame(() => {
    timeout = setTimeout(() => {
      pending.delete(cancel);
      performance.mark(name);
    }, 0);
  });
  pending.add(cancel);
}
