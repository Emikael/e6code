import { ArrowLeftIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { Link, useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { APP_VERSION } from "../../branding";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { connectionPhaseDotClassName } from "../ConnectionStatusDot";
import { connectionPhaseWord } from "../EnvironmentConnectionChip";
import { resolveSidebarEnvironmentReach } from "../Sidebar.logic";
import { BrandStripe, E6Monogram } from "../E6Monogram";
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
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

/**
 * The sidebar's title strip: the E6 tile, the name on one line, and a channel
 * chip for Dev (cyan) and Nightly (orange) builds. The cyan/orange brand
 * stripe runs along the bottom edge on every channel.
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
          className={cn(
            "relative z-10 ml-2 hidden h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10px] leading-none font-semibold tracking-wide @[13rem]/sidebar-header:inline-flex",
            channel === "nightly"
              ? "bg-(--brand-orange)/14 text-(--brand-orange-ink)"
              : "bg-(--brand-cyan)/14 text-(--brand-cyan-ink)",
          )}
        >
          {channelLabel}
        </span>
      ) : null}
      <BrandStripe className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 opacity-90" />
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
        "relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="relative z-10 md:hidden" />
      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2.5 md:ml-[var(--workspace-titlebar-content-left)] md:pr-[var(--sidebar-content-inset)]">
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
            <E6Monogram className="size-7" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <span className="tabular-nums">{build}</span>
          </TooltipPopup>
        </Tooltip>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] leading-[18px] font-semibold text-sidebar-foreground">
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
            <span className="flex min-w-0 items-center gap-[5px] font-mono text-[11px] leading-[14px] text-sidebar-muted-foreground">
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", connectionPhaseDotClassName(phase))}
              />
              <span className="truncate">
                {reach} · {connectionPhaseWord(phase).toLowerCase()}
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </SidebarHeader>
  );
});

function SidebarBrand({ stageLabel }: { stageLabel: string }) {
  const build = stageLabel === "Alpha" ? APP_VERSION : `${stageLabel} ${APP_VERSION}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-label={`Go to threads. E6 Code ${build}`}
            className="relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-8 shrink-0 items-center gap-2 rounded-md pr-1 outline-hidden ring-ring focus-visible:ring-2 md:flex"
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
