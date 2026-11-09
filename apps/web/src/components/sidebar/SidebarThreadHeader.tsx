/**
 * The sidebar's actions under the environment header: a full-width New thread
 * button with its shortcut, then one quiet row holding search, project scope
 * and new project.
 *
 * Search owns the row's text and spans it. Project scope collapses to an icon
 * beside new-project at the end. The scope icon swaps to the project favicon
 * while a project is selected, so the row still names the scope.
 *
 * The scope picker itself is passed in: its combobox state lives with the rest
 * of the sidebar's scope logic. `searchFieldRef` lands on the search field so
 * the picker's popup can anchor to that width rather than to its 28px trigger.
 */
import { FolderPlusIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  /** Lands on the search field so a popup can anchor to its width. */
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  /** Without projects there is nothing to scope, so those controls stay out. */
  hasProjects: boolean;
  /** The project scope combobox, rendered as the first icon of the group. */
  projectScope: ReactNode;
  onNewProject: () => void;
  /** Receives the click so Shift+click can skip the project picker. */
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  /** Shift+click only matters once there is more than one project to pick. */
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
  /** Shown in the idle search field as a jump to the command palette. */
  commandPaletteShortcutLabel: string | null;
  onOpenCommandPalette: () => void;
}

export function SidebarThreadHeader({
  searchFieldRef,
  hasProjects,
  projectScope,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
  commandPaletteShortcutLabel,
  onOpenCommandPalette,
}: SidebarThreadHeaderProps) {
  const resultsVisible = isSearching && searchResultCount > 0;
  // Results shrink as the query narrows, so the active index can outrun the
  // list; pointing aria-activedescendant at a removed option strands the
  // screen reader on nothing.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";

  return (
    <div className="flex flex-col gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="New thread"
              disabled={newThreadDisabled}
              onClick={onNewThread}
              className="flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-foreground/14 bg-sidebar-row-active px-2.5 text-[13px] font-medium text-sidebar-foreground shadow-xs outline-hidden transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 dark:shadow-none"
            />
          }
        >
          <PlusIcon aria-hidden className="size-[15px] shrink-0" />
          <span className="truncate">New thread</span>
          {newThreadShortcutLabel ? (
            <kbd
              aria-hidden
              className="ml-auto shrink-0 font-mono text-[11px] font-normal text-sidebar-muted-foreground pointer-coarse:hidden"
            >
              {newThreadShortcutLabel}
            </kbd>
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
      {/* Search, project scope and new project share one quiet row: they are
          reached far less often than New thread. */}
      <div className="flex items-center gap-0.5">
        <div
          ref={searchFieldRef}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-xs text-sidebar-muted-foreground ring-1 ring-transparent transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-within:bg-sidebar-control-surface focus-within:text-sidebar-foreground focus-within:ring-ring/60"
        >
          <SearchIcon className="size-3.5 shrink-0 text-[var(--sidebar-icon-color)]" />
          <Input
            ref={searchInputRef}
            nativeInput
            unstyled
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search"
            aria-label="Search threads"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={resultsVisible}
            aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
            aria-activedescendant={
              activeResultExists
                ? `sidebar-thread-search-result-${activeSearchResultIndex}`
                : undefined
            }
            className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:text-xs [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground"
          />
          {isSearching ? (
            <Button
              type="button"
              size="icon-micro"
              variant="ghost"
              className="shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
              aria-label="Clear thread search"
              onClick={() => {
                onClearSearch();
                searchInputRef.current?.focus();
              }}
            >
              <XIcon className="size-3" />
            </Button>
          ) : commandPaletteShortcutLabel ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Open command palette (${commandPaletteShortcutLabel})`}
                    onClick={onOpenCommandPalette}
                    className="shrink-0 cursor-pointer rounded font-mono text-[11px] text-sidebar-muted-foreground outline-hidden ring-ring hover:text-sidebar-foreground focus-visible:ring-2 pointer-coarse:hidden"
                  />
                }
              >
                {commandPaletteShortcutLabel}
              </TooltipTrigger>
              <TooltipPopup side="top">Command palette</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        {hasProjects ? (
          <>
            {projectScope}
            <SidebarHeaderIconButton label="New project" onClick={onNewProject}>
              <FolderPlusIcon />
            </SidebarHeaderIconButton>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Small icon button with a tooltip for the header's quiet row. Spreads
 * unknown props through so it can serve as a popup trigger's render target,
 * which injects its own handlers, ref and aria state.
 */
export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  /** Accessible name; also the tooltip unless `tooltip` says more. */
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn(
              "relative size-7 shrink-0 text-sidebar-muted-foreground hover:text-sidebar-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar [&>svg]:size-3.5",
              className,
            )}
          />
        }
      >
        {children}
        {/* Coarse-pointer hit area, matching the rest of the sidebar chrome. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
