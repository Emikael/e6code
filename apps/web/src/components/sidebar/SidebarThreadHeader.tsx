/**
 * The sidebar header: one row holding search, project scope and new thread.
 *
 * Search owns the row's text and spans it. Project scope collapses to an icon
 * that sits with new-project and new-thread as a segmented group at the end.
 * The scope icon swaps to the project favicon while a project is selected,
 * so the header still names the scope after the row that showed it is gone.
 *
 * The scope picker itself is passed in: its combobox state lives with the rest
 * of the sidebar's scope logic. `searchFieldRef` lands on the search field so
 * the picker's popup can anchor to that width rather than to its 28px trigger.
 */
import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
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
import { Kbd } from "../ui/kbd";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  /** Lands on the search field so a popup can anchor to its width. */
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  /** Without projects there is nothing to scope, so those controls stay out. */
  hasProjects: boolean;
  /**
   * The switchboard rail owns project scope and add-project. Defaults to the
   * existing header controls so a caller that omits the prop is unchanged.
   */
  showProjectControls?: boolean;
  /** Switchboard names the palette button by its content (visible key + hidden text). */
  switchboard?: boolean;
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
  showProjectControls = true,
  switchboard = false,
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
    <div className="flex items-center gap-1.5">
      <div
        ref={searchFieldRef}
        className={cn(
          "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-sidebar-border/60 bg-sidebar-control-surface/45 px-2.5 py-1.5 text-sm font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-control-surface/80 hover:text-sidebar-foreground focus-within:bg-sidebar-control-surface focus-within:text-sidebar-foreground",
          // The switchboard drops the input's outline (index.css), so the field
          // draws a full-strength ring; the faded border alone is below 3:1.
          switchboard
            ? "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring"
            : "focus-within:border-ring/60",
        )}
      >
        <SearchIcon className="size-3.5 shrink-0 text-[var(--sidebar-icon-color)]" />
        <Input
          ref={searchInputRef}
          nativeInput
          unstyled
          type="search"
          data-sb-search-input={switchboard || undefined}
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
          className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:placeholder:text-[var(--sidebar-icon-color)]"
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
                  aria-label={
                    switchboard
                      ? undefined
                      : `Open command palette (${commandPaletteShortcutLabel})`
                  }
                  onClick={onOpenCommandPalette}
                  className="shrink-0 cursor-pointer rounded outline-hidden ring-ring focus-visible:ring-2 pointer-coarse:hidden"
                />
              }
            >
              {switchboard && <span className="sr-only">Open command palette </span>}
              <Kbd
                className={cn(
                  "bg-sidebar-control-surface tabular-nums",
                  // sb-muted keeps the key at AA on the light switchboard surface.
                  switchboard ? "text-sb-muted" : "text-sidebar-muted-foreground",
                )}
              >
                {commandPaletteShortcutLabel}
              </Kbd>
            </TooltipTrigger>
            <TooltipPopup side="top">Command palette</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {/* Secondary scope/project icons stay grouped, while New Thread gets
          a tactile primary pill target for Fitts's Law ergonomics. */}
      <div className="flex shrink-0 items-center gap-1">
        {hasProjects && showProjectControls ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {projectScope}
            <SidebarHeaderIconButton label="New project" onClick={onNewProject}>
              <FolderPlusIcon />
            </SidebarHeaderIconButton>
          </div>
        ) : null}
        <SidebarHeaderIconButton
          label="New thread"
          className="h-8 w-auto gap-1.5 rounded-md border border-sidebar-border/80 bg-sidebar-row-active px-2.5 text-xs font-medium text-sidebar-foreground shadow-[inset_0_1px_0_0_var(--bezel-highlight)] hover:bg-sidebar-control-surface"
          tooltip={
            showNewThreadInProjectHint ? (
              <span className="flex flex-col gap-0.5">
                <span>{newThreadLabel}</span>
                <span className="text-muted-foreground">
                  New thread in current project: Shift+click
                  {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
                </span>
              </span>
            ) : (
              newThreadLabel
            )
          }
          disabled={newThreadDisabled}
          onClick={onNewThread}
        >
          <SquarePenIcon className="size-3.5 shrink-0" />
          <span className="hidden min-[240px]:inline">New</span>
        </SidebarHeaderIconButton>
      </div>
    </div>
  );
}

/**
 * Icon button with a tooltip, sized for the header's segmented pair. Spreads
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
              "relative size-8 shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
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
