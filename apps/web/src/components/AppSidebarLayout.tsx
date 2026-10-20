import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { isElectron } from "../env";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useUiStateStore } from "../uiStateStore";
import { useLegacySidebarEnabled } from "../hooks/useSettings";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import LegacyThreadSidebar from "./LegacySidebar";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { ProjectRail } from "./sidebar/ProjectRail";
import { useProjects } from "../state/entities";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  SWITCHBOARD_SIDEBAR_WIDTH_STORAGE_KEY,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  SWITCHBOARD_COLUMN_MAX_WIDTH,
  SWITCHBOARD_COLUMN_MIN_WIDTH,
  SWITCHBOARD_RAIL_WIDTH,
  resolveSwitchboardColumnWidth,
  useSidebar,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

function readStoredWidth(storageKey: string): number | null {
  try {
    return getLocalStorageItem(storageKey, Schema.Finite);
  } catch (error) {
    console.error("Could not read persisted sidebar width.", error);
    return null;
  }
}

function readInitialThreadSidebarWidth(): number {
  return resolveInitialThreadSidebarWidth(
    readStoredWidth(THREAD_SIDEBAR_WIDTH_STORAGE_KEY),
    window.innerWidth,
  );
}

function readInitialSwitchboardSidebarWidth(): number {
  return (
    resolveSwitchboardColumnWidth(
      readStoredWidth(SWITCHBOARD_SIDEBAR_WIDTH_STORAGE_KEY),
      window.innerWidth,
    ) + SWITCHBOARD_RAIL_WIDTH
  );
}

function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B for bold; the toggle stays
        // available everywhere else, including the plain-text composer.
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    // Capture before focused editors consume commands such as Mod+B for rich-text formatting.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, toggleSidebar]);

  return (
    // The right-side layout controls carry mr-px (border compensation inside
    // the panel), so the trigger mirrors it: both clusters sit one extra pixel
    // off their edge and the titlebar reads symmetric.
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center"
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger className="pointer-events-auto" aria-label="Toggle main sidebar" />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

function SwitchboardSidebarFrame({
  isOnSettings,
  pathname,
}: {
  isOnSettings: boolean;
  pathname: string;
}) {
  const { isMobile } = useSidebar();
  return (
    <div
      data-switchboard="sidebar"
      className={isMobile ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-row"}
    >
      <ProjectRail orientation={isMobile ? "horizontal" : "vertical"} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isOnSettings ? (
          <>
            <SidebarChromeHeader isElectron={isElectron} />
            <SettingsSidebarNav pathname={pathname} />
          </>
        ) : (
          <ThreadSidebar />
        )}
      </div>
    </div>
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const switchboard = useUiStateStore((store) => store.sidebarSwitchboard);
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  // Settings routes show the settings nav in place of whichever thread
  // sidebar is active.
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    useUiStateStore.getState().sidebarSwitchboard
      ? readInitialSwitchboardSidebarWidth()
      : readInitialThreadSidebarWidth(),
  );
  const [widthMode, setWidthMode] = useState(switchboard);
  if (widthMode !== switchboard) {
    setWidthMode(switchboard);
    setSidebarWidth(
      switchboard ? readInitialSwitchboardSidebarWidth() : readInitialThreadSidebarWidth(),
    );
  }
  // Subscribed rather than read once: the clamp must track live window size,
  // and a clamped drag ends with an unchanged width, which skips the re-render
  // that would otherwise refresh a render-time snapshot.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const sidebarMaximumWidth = switchboard
    ? Math.min(
        SWITCHBOARD_COLUMN_MAX_WIDTH,
        Math.max(
          SWITCHBOARD_COLUMN_MIN_WIDTH,
          Math.floor(viewportWidth) - THREAD_MAIN_CONTENT_MIN_WIDTH - SWITCHBOARD_RAIL_WIDTH,
        ),
      ) + SWITCHBOARD_RAIL_WIDTH
    : resolveThreadSidebarMaximumWidth(viewportWidth);
  const resetSidebarWidth = () => {
    if (switchboard) {
      try {
        removeLocalStorageItem(SWITCHBOARD_SIDEBAR_WIDTH_STORAGE_KEY);
      } catch (error) {
        console.error("Could not clear persisted switchboard column width.", error);
      }
      setSidebarWidth(resolveSwitchboardColumnWidth(null, viewportWidth) + SWITCHBOARD_RAIL_WIDTH);
      return;
    }
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const persistSwitchboardWidth = (totalWidth: number) => {
    setSidebarWidth(totalWidth);
    try {
      setLocalStorageItem(
        SWITCHBOARD_SIDEBAR_WIDTH_STORAGE_KEY,
        Math.round(totalWidth - SWITCHBOARD_RAIL_WIDTH),
        Schema.Finite,
      );
    } catch (error) {
      console.error("Could not persist switchboard column width.", error);
    }
  };
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...(isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      <SidebarProvider
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        defaultOpen
        style={sidebarProviderStyle}
      >
        <ProjectProjectionRetention />
        <Sidebar
          side="left"
          collapsible="offcanvas"
          data-app-sidebar=""
          className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
          resizable={
            switchboard
              ? {
                  maxWidth: sidebarMaximumWidth,
                  minWidth: SWITCHBOARD_COLUMN_MIN_WIDTH + SWITCHBOARD_RAIL_WIDTH,
                  shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
                    nextWidth <= currentWidth ||
                    wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
                  onResize: persistSwitchboardWidth,
                }
              : {
                  maxWidth: sidebarMaximumWidth,
                  minWidth: THREAD_SIDEBAR_MIN_WIDTH,
                  shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
                    nextWidth <= currentWidth ||
                    wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
                  storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
                  onResize: setSidebarWidth,
                }
          }
        >
          {switchboard ? (
            <SwitchboardSidebarFrame isOnSettings={isOnSettings} pathname={pathname} />
          ) : isOnSettings ? (
            <>
              <SidebarChromeHeader isElectron={isElectron} />
              <SettingsSidebarNav pathname={pathname} />
            </>
          ) : legacySidebarEnabled ? (
            <LegacyThreadSidebar />
          ) : (
            <ThreadSidebar />
          )}
          <SidebarRail onDoubleClick={resetSidebarWidth} />
        </Sidebar>
        {children}
        <SidebarControl />
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
