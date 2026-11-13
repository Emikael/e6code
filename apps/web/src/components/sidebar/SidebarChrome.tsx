import { useAtomValue } from "@effect/atom-react";
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  PanelLeftIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { Link, useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { APP_VERSION } from "../../branding";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { shortcutLabelForCommand } from "../../keybindings";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import { connectionPhaseWord } from "../EnvironmentConnectionChip";
import { resolveSidebarEnvironmentReach } from "../Sidebar.logic";
import { E6Monogram } from "../E6Monogram";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { SidebarDoneToday } from "./SidebarDoneToday";
import { SidebarParked } from "./SidebarParked";
import { SIDEBAR_NAV_ROW_CLASS } from "./sidebarNavRow";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

/**
 * The sidebar's title strip: the E6 tile, the name on one line, and a channel
 * chip for Dev and Nightly builds.
 */
export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const channel =
    environmentIdentificationMode === "none"
      ? null
      : resolveSidebarStageBackdropVariant(stageLabel);
  const channelLabel = resolveEnvironmentIdentificationPillLabel(stageLabel);

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="relative z-10 md:hidden" />
      <SidebarBrand stageLabel={stageLabel} />
      {channel && channelLabel ? (
        <span
          data-environment-identification={channel}
          className="relative z-10 ml-2 hidden h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10px] leading-none font-semibold tracking-wide text-sidebar-muted-foreground ring-1 ring-sidebar-border ring-inset @[13rem]/sidebar-header:inline-flex"
        >
          {channelLabel}
        </span>
      ) : null}
      <SidebarHeaderToggle className="ml-auto md:mr-2.5" />
    </SidebarHeader>
  );
});

/**
 * The thread sidebar's title strip: the E6 tile, then the environment this
 * client is driving, with its reach and connection phase in words under it
 * ("local · connected"). E6 runs local, over Tailscale and through tunnels,
 * so which machine you are on stays in view. The Dev/Nightly chip stays as a
 * quiet tag after the name for builds that identify their channel.
 */
export const SidebarEnvironmentHeader = memo(function SidebarEnvironmentHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const channel =
    environmentIdentificationMode === "none"
      ? null
      : resolveSidebarStageBackdropVariant(stageLabel);
  const channelLabel = resolveEnvironmentIdentificationPillLabel(stageLabel);
  const environment = usePrimaryEnvironment();
  const build = stageLabel === "Alpha" ? APP_VERSION : `${stageLabel} ${APP_VERSION}`;
  const reach = environment
    ? resolveSidebarEnvironmentReach({
        targetKind: environment.entry.target._tag,
        httpBaseUrl: environment.displayUrl,
      })
    : null;
  const phase = environment?.connection.phase ?? null;

  return (
    <SidebarHeader
      className={cn(
        // Board 1: a 40px row whose center lines up with the main header's.
        "relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:h-[calc(var(--workspace-topbar-height)/2+1.25rem)] md:pt-[calc(var(--workspace-topbar-height)/2-1.25rem)] md:pr-2.5 md:pl-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="relative z-10 md:hidden" />
      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2 md:ml-[var(--sidebar-header-inset)]">
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                aria-label={`Go to threads. E6 Code ${build}`}
                className="hidden shrink-0 rounded-lg outline-hidden ring-ring focus-visible:ring-2 md:flex"
                to="/"
              />
            }
          >
            {/* Board 1: a 22px tile, radius 6px, inside a 1px input ring. */}
            <span className="flex rounded-[6px] shadow-[0_0_0_1px_var(--color-input)]">
              <E6Monogram className="size-[22px]" />
            </span>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <span className="tabular-nums">{build}</span>
          </TooltipPopup>
        </Tooltip>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] leading-[18px] font-medium text-sidebar-foreground">
              {environment?.label ?? "E6 Code"}
            </span>
            {channel && channelLabel ? (
              <span
                data-environment-identification={channel}
                className="shrink-0 rounded-sm px-1 text-[10px] leading-4 font-medium text-sidebar-muted-foreground ring-1 ring-sidebar-border ring-inset"
              >
                {channelLabel}
              </span>
            ) : null}
          </div>
          {reach && phase ? (
            // Words only (board 1): the phase is named, so no colored dot.
            <span className="truncate font-mono text-[11px] leading-[14px] text-sidebar-muted-foreground">
              {reach} · {connectionPhaseWord(phase).toLowerCase()}
            </span>
          ) : null}
        </div>
      </div>
      <SidebarHeaderToggle className="relative z-10 ml-2" />
    </SidebarHeader>
  );
});

/**
 * Hides the sidebar from its own header's right end (board 1: a 28px ghost
 * icon button). While the sidebar is collapsed the window-edge control in
 * AppSidebarLayout reopens it; Mod+B works either way.
 */
function SidebarHeaderToggle({ className }: { className?: string }) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");
  const label = "Hide sidebar";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            aria-label={label}
            onClick={toggleSidebar}
            className={cn(
              "hidden size-7 shrink-0 rounded-md text-sidebar-muted-foreground hover:text-sidebar-foreground md:inline-flex [-webkit-app-region:no-drag] [&_svg]:size-4",
              className,
            )}
          />
        }
      >
        <PanelLeftIcon aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarBrand({ stageLabel }: { stageLabel: string }) {
  const build = stageLabel === "Alpha" ? APP_VERSION : `${stageLabel} ${APP_VERSION}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-label={`Go to threads. E6 Code ${build}`}
            className="relative z-10 ml-[var(--sidebar-header-inset)] hidden h-8 shrink-0 items-center gap-2 rounded-md pr-1 outline-hidden ring-ring focus-visible:ring-2 md:flex"
            to="/"
          />
        }
      >
        <E6Monogram className="size-5" />
        <span className="text-[13px] leading-none font-semibold tracking-[-0.01em] whitespace-nowrap text-foreground">
          E6 Code
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="tabular-nums">{build}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const currentFooterPage = useLocation({
    select: (location) =>
      /^\/settings(?:\/|$)/.test(location.pathname)
        ? "settings"
        : /^\/projects\/[^/]+\/?$/.test(location.pathname)
          ? "project-settings"
          : location.pathname === "/usage"
            ? "usage"
            : location.pathname === "/pull-requests"
              ? "pull-requests"
              : null,
  });
  const { environments } = useEnvironments();
  // The page reads every connected server, so one of them offering pull requests is enough for
  // the link to lead somewhere.
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, closeMobileSidebar, navigate]);

  return (
    <SidebarMenu className="flex-row items-center">
      {currentFooterPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label="Pull Requests"
              onClick={handlePullRequestsClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
          />
        </>
      )}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter className="px-[var(--sidebar-content-inset)] py-1">
      <SidebarParked />
      <SidebarDoneToday />
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});

/**
 * The thread sidebar's foot (board 1): Parked, Done today and Settings as
 * 32px rows 2px apart. Pull requests and Usage live in the command palette
 * and the navigation rail. Update notices, when there are any, sit above the
 * rows.
 */
export const SidebarThreadFooter = memo(function SidebarThreadFooter() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  // Project settings keep this sidebar; its third row leads back from there.
  const onProjectSettings = useLocation({
    select: (location) => /^\/projects\/[^/]+\/?$/.test(location.pathname),
  });
  const handleSettingsClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    if (onProjectSettings) {
      if (canGoBack) window.history.back();
      else void navigate({ to: "/" });
      return;
    }
    void navigate({ to: "/settings" });
  }, [canGoBack, isMobile, navigate, onProjectSettings, setOpenMobile]);

  return (
    <SidebarFooter className="gap-0.5 px-[var(--sidebar-content-inset)] pt-1 pb-[var(--sidebar-content-inset)]">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarMenu className="flex-row justify-end empty:hidden">
        <SidebarUpdatePill />
      </SidebarMenu>
      <SidebarParked />
      <SidebarDoneToday />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={handleSettingsClick} className={SIDEBAR_NAV_ROW_CLASS}>
            {onProjectSettings ? <ArrowLeftIcon /> : <SlidersHorizontalIcon />}
            <span className="min-w-0 flex-1 truncate">
              {onProjectSettings ? "Back" : "Settings"}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});
