import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";
import { cn } from "~/lib/utils";

/** A line of thread state for the end of the timeline. */
export interface ThreadNowItem {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

const lineClassName = cn(
  "mx-auto flex w-full min-w-0 max-w-(--chat-max-width) items-center gap-1.5 px-1 pb-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
  "transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
);

/** One line of thread state at the end of the timeline: icon, title, detail, then actions. */
function ThreadNowLine({ item }: { readonly item: ThreadNowItem }) {
  return (
    <div className={lineClassName} data-thread-now-line="true">
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        {item.icon}
      </span>
      {/* Title and detail give way before the actions, so Stop stays reachable. */}
      <span className="min-w-0 truncate">
        {item.title}
        {item.description ? (
          <>
            {" "}
            <span aria-hidden>·</span> {item.description}
          </>
        ) : null}
      </span>
      {item.actions ? (
        <>
          <span aria-hidden>·</span>
          <span className="flex shrink-0 items-center gap-1.5">{item.actions}</span>
        </>
      ) : null}
    </div>
  );
}

function ThreadSyncLine({ phase }: { readonly phase: ThreadSyncPhase }) {
  return (
    <div className={lineClassName} role="status" data-composer-sync-status={phase}>
      <RefreshCwIcon aria-hidden />
      <span className="truncate">{threadSyncLabel(phase)}</span>
    </div>
  );
}

/** What the thread is doing now, at the end of the timeline: background work, then sync status. */
export function ThreadNow({
  work,
  syncPhase,
}: {
  readonly work: ThreadNowItem | null;
  readonly syncPhase: ThreadSyncPhase | null;
}): ReactNode {
  if (work === null && syncPhase === null) return null;
  return (
    <>
      {work ? <ThreadNowLine item={work} /> : null}
      {syncPhase ? <ThreadSyncLine phase={syncPhase} /> : null}
    </>
  );
}
