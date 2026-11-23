import type { EnvironmentId, ThreadId } from "@e6tools/contracts";
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import {
  nextThreadMarks,
  threadMarkProgress,
  type ThreadMarkProgress,
} from "@e6tools/shared/threadMarks";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

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
  // those must still land, while leaving the thread cancels any that have not. A cancelled
  // mark no longer counts as set, so StrictMode's replayed mount schedules it again.
  const [marks] = useState(() => ({
    pending: new Map<string, () => void>(),
    landed: new Set<string>(),
  }));
  useEffect(
    () => () => {
      for (const cancel of marks.pending.values()) cancel();
      marks.pending.clear();
    },
    [marks],
  );
  const progress = useCallback(
    () => threadMarkProgress([...marks.landed, ...marks.pending.keys()]),
    [marks],
  );
  const schedule = useCallback((name: string) => markAfterNextFrame(name, marks), [marks]);
  const stopWatching = useCallback(() => setWatching(false), []);
  return watching ? (
    <ThreadMarksWatcher
      environmentId={environmentId}
      threadId={threadId}
      hasRows={hasRows}
      progress={progress}
      schedule={schedule}
      onDone={stopWatching}
    />
  ) : null;
});

function ThreadMarksWatcher({
  environmentId,
  threadId,
  hasRows,
  progress,
  schedule,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly hasRows: boolean;
  readonly progress: () => ThreadMarkProgress;
  readonly schedule: (name: string) => void;
  readonly onDone: () => void;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const status = useThreadStatus(threadRef);
  useEffect(() => {
    for (const name of nextThreadMarks({ status, hasRows, marked: progress() })) schedule(name);
    const marked = progress();
    if (marked.rows && marked.live) onDone();
  }, [status, hasRows, progress, schedule, onDone]);
  return null;
}

/**
 * Stamps once the frame that shows the change has been produced; cancellable until then. An
 * earlier visit's mark of the same name is cleared first, so marks do not pile up.
 */
function markAfterNextFrame(
  name: string,
  marks: { readonly pending: Map<string, () => void>; readonly landed: Set<string> },
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timeout = setTimeout(() => {
      marks.pending.delete(name);
      marks.landed.add(name);
      performance.clearMarks(name);
      performance.mark(name);
    }, 0);
  });
  marks.pending.set(name, () => {
    cancelAnimationFrame(frame);
    if (timeout !== undefined) clearTimeout(timeout);
  });
}
