import { Link, useLocation } from "@tanstack/react-router";
import { ChartNoAxesColumnIcon, MessageCircleIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { APP_VERSION } from "../branding";
import { cn } from "../lib/utils";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { useEnvironments } from "../state/environments";
import { appNavDestinationOf, type AppNavDestination } from "./appNavRail.logic";
import { E6Monogram } from "./E6Monogram";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "./pullRequest/pullRequestListPreferences";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function AppNavRailItem({
  destination,
  current,
  label,
  shortcut,
  icon,
  link,
  className,
}: {
  destination: AppNavDestination;
  current: AppNavDestination | null;
  label: string;
  shortcut?: string | null;
  icon: ReactNode;
  /** The bare router link to the destination; the item adds its label, state and look. */
  link: ReactElement;
  className?: string;
}) {
  const isCurrent = destination === current;
  return (
    <Tooltip>
      <TooltipTrigger
        render={link}
        aria-label={label}
        aria-current={isCurrent ? "page" : undefined}
        data-app-nav={destination}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-[10px] outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px] [&_svg]:stroke-[1.75]",
          isCurrent
            ? "bg-sidebar-row-selected text-sidebar-foreground shadow-xs/5 ring-1 ring-border"
            : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          className,
        )}
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="right">
        {label}
        {shortcut ? <span className="ml-1.5 text-muted-foreground">{shortcut}</span> : null}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The slim app navigation the pull requests and usage pages show in place of the thread sidebar:
 * the E6 mark, then Threads, Pull requests and Usage, with Settings at the foot. The current
 * page's button is raised and carries `aria-current="page"`.
 *
 * `settingsShortcut` is the label of the shortcut that opens Settings where one exists (the
 * desktop menu's), and `reserveWindowControls` leaves room above the mark for native window
 * buttons drawn over the rail.
 */
export function AppNavRail({
  electron = false,
  reserveWindowControls = false,
  settingsShortcut = null,
  className,
}: {
  electron?: boolean;
  reserveWindowControls?: boolean;
  settingsShortcut?: string | null;
  className?: string;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const current = appNavDestinationOf(pathname);
  const { environments } = useEnvironments();
  // The same gate the sidebar footer uses: one connected server offering pull requests is
  // enough for the page to lead somewhere. A reader already on the page keeps its button.
  const pullRequestsSupported =
    current === "pull-requests" ||
    environments.some(
      (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
    );

  return (
    <div
      {...workspaceAreaProps("sidebar", 0, "App navigation")}
      data-app-nav-rail=""
      // Marked as the floating sidebar's peer, so the page panel beside it keeps the same gaps it
      // has next to the thread sidebar.
      data-variant="floating"
      data-state="expanded"
      className={cn(
        "peer hidden h-dvh shrink-0 p-(--panel-gap) outline-hidden md:flex",
        reserveWindowControls
          ? // Wide enough that the native buttons sit inside the rail rather than over the page.
            "w-[max(calc(56px+2*var(--panel-gap)),calc(var(--desktop-window-controls-inset,90px)+var(--panel-gap)))]"
          : "w-[calc(56px+2*var(--panel-gap))]",
        className,
      )}
    >
      <nav
        aria-label="App"
        className={cn(
          "flex w-full flex-col items-center gap-1.5 rounded-(--radius-panel) border border-sidebar-border bg-sidebar pb-3 text-sidebar-foreground shadow-sm/5 surface-grain",
          reserveWindowControls ? "pt-[var(--workspace-topbar-height)]" : "pt-3",
          electron && "drag-region",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                to="/"
                aria-label={`Go to threads. E6 Code ${APP_VERSION}`}
                className="mb-2 flex shrink-0 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <E6Monogram className="size-[30px]" />
          </TooltipTrigger>
          <TooltipPopup side="right">
            E6 Code <span className="tabular-nums">{APP_VERSION}</span>
          </TooltipPopup>
        </Tooltip>
        <AppNavRailItem
          destination="threads"
          current={current}
          label="Threads"
          icon={<MessageCircleIcon aria-hidden />}
          link={<Link to="/" />}
        />
        {pullRequestsSupported ? (
          <AppNavRailItem
            destination="pull-requests"
            current={current}
            label="Pull requests"
            icon={<PullRequestGlyph.pullRequest aria-hidden />}
            // The list opens on the filters the reader last left it with, as from the sidebar.
            link={<Link to="/pull-requests" search={() => readPullRequestListPreferences()} />}
          />
        ) : null}
        <AppNavRailItem
          destination="usage"
          current={current}
          label="Usage"
          icon={<ChartNoAxesColumnIcon aria-hidden />}
          link={<Link to="/usage" />}
        />
        <AppNavRailItem
          destination="settings"
          current={current}
          label="Settings"
          shortcut={settingsShortcut}
          icon={<SlidersHorizontalIcon aria-hidden />}
          link={<Link to="/settings" />}
          className="mt-auto"
        />
      </nav>
    </div>
  );
}
