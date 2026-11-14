import type {
  PullRequestActor,
  PullRequestMergeability,
  PullRequestState,
} from "@e6tools/contracts";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  PullRequestActorAvatar,
  PullRequestConflictGlyph,
  PullRequestStateGlyph,
} from "./pullRequestPresentation";

/**
 * The conflict warning rides the corner of the lifecycle glyph, over the arrow's merge circle,
 * so the leading slot stays one icon wide and titles line up whether or not a row is blocked.
 * The background fill cuts it out of the glyph beneath.
 */
export function PullRequestRowGlyph({
  state,
  isDraft,
  mergeability,
  baseBranch,
  below,
  className,
}: {
  state: PullRequestState;
  isDraft: boolean;
  mergeability?: PullRequestMergeability | undefined;
  baseBranch?: string | undefined;
  /** Under the lifecycle glyph, level with the second line: the checks glyph. */
  below?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex w-4 shrink-0 flex-col items-center gap-0.5", className)}>
      <span className="relative inline-flex">
        <PullRequestStateGlyph state={state} isDraft={isDraft} />
        {/* The wrapper takes the offset, not the icon, so the tooltip trigger inside keeps the
            badge's size and anchors the popup to it. */}
        <span className="absolute -right-1 -bottom-1 inline-flex">
          <PullRequestConflictGlyph
            state={state}
            isDraft={isDraft}
            {...(mergeability === undefined ? {} : { mergeability })}
            {...(baseBranch === undefined ? {} : { baseBranch })}
            className="size-3 fill-background [stroke-width:2.5]"
          />
        </span>
      </span>
      {below ? <span className="inline-flex text-[11px]">{below}</span> : null}
    </span>
  );
}

/** Avatar and login at the meta line's own size, with the actor's full name on hover. */
export function PullRequestRowAuthor({
  actor,
  className,
  labelClassName,
}: {
  actor: PullRequestActor | null;
  className?: string;
  labelClassName?: string;
}) {
  const login = actor?.login ?? "ghost";
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn("inline-flex min-w-0 items-center gap-1", className)} />}
      >
        <PullRequestActorAvatar actor={actor} className="size-3.5" />
        <span className={cn("truncate", labelClassName)}>{login}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {actor?.name && actor.name !== login ? `${actor.name} (@${login})` : login}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * `head → base`, in the mono the branches are typed in, each cut in the middle when the row is
 * short of room. The base keeps its width up to a share of the line, so a long head cannot
 * squeeze a short `main` out; the arrow stays readable so the two are not read as one name.
 */
export function PullRequestRowBranches({ head, base }: { head: string; base: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 font-mono">
      <MiddleTruncate value={head} />
      <span className="shrink-0">→</span>
      <MiddleTruncate value={base} className="max-w-[45%] shrink-0" />
    </span>
  );
}
