/**
 * The sidebar's actions under the environment header (board 1): a full-width
 * New thread button with its shortcut in key caps, and Park a thought beside
 * it. Search, project scope and new project live in the command palette.
 */
import { InboxIcon, PlusIcon } from "lucide-react";
import { type MouseEvent as ReactMouseEvent } from "react";

import { cn } from "~/lib/utils";
import { ShortcutKeyCaps } from "../ShortcutKeyCaps";
import { openCaptureBar } from "~/parkedThoughts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Board 1 `.btn--outline`: 32px, card fill, input border, 13px/500. */
const OUTLINE_BUTTON_CLASS =
  "flex h-8 cursor-pointer items-center rounded-lg border border-input bg-card text-[13px] leading-[18px] font-medium text-sidebar-foreground outline-hidden transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar disabled:cursor-default disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0";

export interface SidebarThreadHeaderProps {
  /** Receives the click so Shift+click can skip the project picker. */
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  /** The start screen is open: New thread reads as the current page (board 1). */
  newThreadCurrent: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  /** Shift+click only matters once there is more than one project to pick. */
  showNewThreadInProjectHint: boolean;
  /** "Park a thought" beside New thread (board 2). */
  parkShortcutLabel?: string | null;
}

export function SidebarThreadHeader({
  onNewThread,
  newThreadDisabled,
  newThreadCurrent,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  parkShortcutLabel = null,
}: SidebarThreadHeaderProps) {
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="New thread"
              aria-current={newThreadCurrent ? "page" : undefined}
              disabled={newThreadDisabled}
              onClick={onNewThread}
              className={cn(
                OUTLINE_BUTTON_CLASS,
                "min-w-0 flex-1 gap-2 px-3",
                newThreadCurrent && "bg-sidebar-row-selected hover:bg-sidebar-row-selected",
              )}
            />
          }
        >
          <PlusIcon aria-hidden />
          <span className="shrink-0 whitespace-nowrap">New thread</span>
          {newThreadShortcutLabel ? (
            // The label never yields to its hint: when the caps do not fit beside it they wrap
            // past the zero-width spacer onto a clipped second line and disappear whole.
            <span className="flex h-5 min-w-0 flex-1 flex-wrap justify-end overflow-hidden pointer-coarse:hidden">
              <span aria-hidden className="h-5 w-0" />
              <ShortcutKeyCaps label={newThreadShortcutLabel} compact />
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {showNewThreadInProjectHint ? (
            <span className="flex flex-col gap-0.5">
              <span>{newThreadLabel}</span>
              <span className="text-muted-foreground">
                New thread in current project: Shift+click
                {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
              </span>
            </span>
          ) : (
            newThreadLabel
          )}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Park a thought"
              onClick={openCaptureBar}
              className={cn(OUTLINE_BUTTON_CLASS, "size-8 shrink-0 justify-center")}
            />
          }
        >
          <InboxIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {parkShortcutLabel ? `Park a thought (${parkShortcutLabel})` : "Park a thought"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
