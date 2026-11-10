import { Link } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";

import { cn } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  joinPullRequestThreads,
  reconcilePullRequestThreads,
  type PullRequestLinkedThreads,
} from "./pullRequestTriage.logic";

/**
 * The thread join, held outside the page so that thread updates redraw only the rows whose
 * threads changed, not the whole list.
 */
const useLinkedThreadsStore = create<{
  readonly byKey: ReadonlyMap<string, PullRequestLinkedThreads>;
}>(() => ({ byKey: new Map() }));

/** Keeps the join current while the list is mounted. Renders nothing. */
export function PullRequestThreadJoin(): null {
  const threads = useThreadShells();
  useEffect(() => {
    const held = useLinkedThreadsStore.getState().byKey;
    const next = reconcilePullRequestThreads(held, joinPullRequestThreads(threads));
    if (next !== held) useLinkedThreadsStore.setState({ byKey: next });
  }, [threads]);
  return null;
}

/**
 * "Agent working" while an agent in a linked thread is running, otherwise how many threads are
 * linked; either opens the thread. Primary only for the live agent, and always with words or a
 * count beside the mark. A real link beside the row's button, never inside it; it stops its click
 * so following it does not also select the row.
 */
export function PullRequestRowThreads({ threadKey }: { threadKey: string }) {
  const linked = useLinkedThreadsStore((state) => state.byKey.get(threadKey) ?? null);
  if (linked === null) return null;
  const label = linked.working
    ? `Agent working in ${linked.title}`
    : linked.count === 1
      ? `Linked thread: ${linked.title}`
      : `${linked.count} linked threads, latest ${linked.title}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: linked.environmentId, threadId: linked.threadId }}
            aria-label={label}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center outline-none focus-visible:ring-1 focus-visible:ring-ring",
              // A live agent wears the iris chip the status chips share the shape of.
              linked.working
                ? "h-[22px] gap-1.5 rounded-md bg-primary-surface px-1.5 text-xs font-medium text-primary-text hover:bg-primary/12"
                : "gap-1 rounded-sm px-1 text-muted-foreground hover:bg-accent",
            )}
          />
        }
      >
        {linked.working ? (
          <>
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            Agent working
          </>
        ) : (
          <>
            <MessageSquareIcon aria-hidden className="size-3" />
            <span className="tabular-nums">{linked.count}</span>
          </>
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
