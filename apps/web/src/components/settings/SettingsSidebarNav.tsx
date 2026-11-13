import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { primaryServerProvidersAtom } from "../../state/server";
import { SidebarContent, SidebarFooter, SidebarMenu, useSidebar } from "../ui/sidebar";
import { SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import {
  isSettingsOverviewVisible,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
} from "./settingsSearch";
import { validateSettingsScopeSearch } from "./settingsScope";
import {
  groupSettingsNavItems,
  SETTINGS_DETAIL_PAGES,
  SETTINGS_OVERLAY_SELECTOR,
  settingsConnectionsBadge,
  settingsProvidersBadge,
} from "./settingsNavGroups";
import { useSettingsBackLabel, useSettingsBackNavigation } from "./useSettingsBackNavigation";

const E6ConnectSidebarSignIn = lazy(() =>
  import("../clerk/E6ConnectSidebarSignIn").then((module) => ({
    default: module.E6ConnectSidebarSignIn,
  })),
);
const E6ConnectSidebarAvatar = lazy(() =>
  import("../clerk/E6ConnectSidebarSignIn").then((module) => ({
    default: module.E6ConnectSidebarAvatar,
  })),
);

const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsPath;
}> = (Object.keys(SETTINGS_SECTION_LABELS) as SettingsPath[]).map((to) => ({
  to,
  label: SETTINGS_SECTION_LABELS[to],
}));

/** Board 6's nav row: 32px, 13px medium, the selected page on the raised row with a hairline. */
const NAV_ROW_CLASS =
  "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] leading-[18px] font-medium text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring";

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const currentSearch = useLocation({ select: (location) => location.search });
  const scopeSearch = useMemo(() => validateSettingsScopeSearch(currentSearch), [currentSearch]);
  const showProjectPage = isSettingsOverviewVisible(scopeSearch);
  const navGroups = useMemo(
    () =>
      groupSettingsNavItems(
        SETTINGS_NAV_ITEMS.filter((item) => item.to !== "/settings/projects" || showProjectPage),
      ),
    [showProjectPage],
  );
  const providers = useAtomValue(primaryServerProvidersAtom);
  const { environments } = useEnvironments();
  const providersBadge = useMemo(() => settingsProvidersBadge(providers), [providers]);
  const connectionsBadge = useMemo(() => settingsConnectionsBadge(environments), [environments]);
  const { isMobile, setOpenMobile } = useSidebar();
  const navigateBack = useSettingsBackNavigation();
  const backLabel = useSettingsBackLabel();

  // Board 6 has no search field: "/" opens the command palette, which searches the same
  // settings index and jumps to the row.
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          // Keep focus inside open dialogs and popups.
          target.closest(SETTINGS_OVERLAY_SELECTOR) !== null)
      ) {
        return;
      }
      event.preventDefault();
      openCommandPalette();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSectionClick = useCallback(
    (to: SettingsPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to,
        hash: "",
        replace: true,
        hashScrollIntoView: false,
      });
    },
    [isMobile, navigate, setOpenMobile],
  );
  return (
    <>
      {/* The desktop window keeps its drag strip and traffic-light room above the nav. */}
      {isElectron ? (
        <div aria-hidden className="drag-region h-[var(--workspace-topbar-height)] shrink-0" />
      ) : null}
      <SidebarContent className="overflow-x-hidden">
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5 p-2">
          <button
            type="button"
            onClick={() => {
              if (isMobile) setOpenMobile(false);
              navigateBack();
            }}
            aria-keyshortcuts="Escape"
            className={cn(NAV_ROW_CLASS, "mb-1")}
          >
            <ArrowLeftIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {backLabel === "Back" ? backLabel : `Back to ${backLabel.toLowerCase()}`}
            </span>
          </button>
          {navGroups.map((group) => {
            const headingId = `settings-nav-group-${group.label.toLowerCase()}`;
            return (
              <section
                key={group.label}
                aria-labelledby={headingId}
                className="flex flex-col gap-0.5"
              >
                <h2
                  id={headingId}
                  className="px-2.5 pt-2 pb-1 text-[11px] leading-[14px] font-medium tracking-[0.01em] text-sidebar-muted-foreground"
                >
                  {group.label}
                </h2>
                {group.items.map((item) => {
                  const isDetailPage = SETTINGS_DETAIL_PAGES[pathname]?.parent === item.to;
                  const isActive =
                    isDetailPage || pathname === item.to || pathname.startsWith(`${item.to}/`);
                  const badge =
                    item.to === "/settings/providers"
                      ? providersBadge
                      : item.to === "/settings/connections"
                        ? connectionsBadge
                        : null;
                  return (
                    <button
                      key={item.to}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => handleSectionClick(item.to)}
                      className={cn(
                        NAV_ROW_CLASS,
                        isActive &&
                          "bg-sidebar-row-selected shadow-xs ring-1 ring-input hover:bg-sidebar-row-selected",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {badge ? (
                        <span
                          className={cn(
                            "shrink-0 font-mono text-[11px] font-normal tabular-nums",
                            badge.tone === "warning"
                              ? "flex h-5 items-center rounded-sm bg-warning-surface px-1.5 font-medium text-warning-foreground"
                              : "text-sidebar-muted-foreground",
                          )}
                        >
                          <span aria-hidden="true">{badge.text}</span>
                          <span className="sr-only">{badge.label}</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </nav>
      </SidebarContent>
      {/* Account and update notices stay reachable here; each renders nothing when idle. */}
      <SidebarFooter className="px-[var(--sidebar-content-inset)] py-1">
        <Suspense fallback={null}>
          <E6ConnectSidebarSignIn />
        </Suspense>
        <div className="flex items-center gap-1">
          <SidebarMenu className="min-w-0 flex-1 flex-row items-center">
            <SidebarUpdatePill />
          </SidebarMenu>
          <Suspense fallback={null}>
            <E6ConnectSidebarAvatar />
          </Suspense>
        </div>
      </SidebarFooter>
    </>
  );
}
