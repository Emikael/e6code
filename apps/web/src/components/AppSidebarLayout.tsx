import { useAtomValue } from "@effect/atom-react";
import { moveWorkspaceFocus, startWorkspaceFocus, workspaceAreaProps } from "../lib/workspaceFocus";
import * as Schema from "effect/Schema";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";

import { isElectron } from "../env";
import { getLocalStorageItem, removeLocalStorageItem } from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import {
  canAnimate,
  EASE_IN_OUT,
  MOTION_MS,
  playTransient,
  prefersReducedMotion,
  type TransientMotion,
} from "../lib/motion";
import { isMacPlatform } from "../lib/utils";
import { useUiStateStore } from "../uiStateStore";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useFocusModeActive } from "../hooks/useFocusMode";
import { useLegacySidebarEnabled } from "../hooks/useSettings";
import { useIsMobile } from "../hooks/useMediaQuery";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import { AppNavRail } from "./AppNavRail";
import { showsAppNavRail } from "./appNavRail.logic";
import LegacyThreadSidebar from "./LegacySidebar";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { useProjects } from "../state/entities";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function ignoreSidebarOpenChange() {}

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

/**
 * The sidebar toggle's shortcut, and the window-edge control that reopens a
 * collapsed sidebar. While the sidebar shows, its header carries the toggle
 * (board 1), so the window-edge control leaves. Narrow windows keep it: the
 * sidebar there is a sheet that this control opens.
 */
function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, state, toggleSidebar } = useSidebar();
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

  if (!isMobile && state === "expanded") return null;

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
            <SidebarTrigger
              className="pointer-events-auto"
              aria-label={isMobile ? "Toggle main sidebar" : "Show sidebar"}
            />
          }
        />
        <TooltipPopup side="bottom">
          {isMobile ? "Toggle main sidebar" : "Show sidebar"}
          {shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * F6 and Shift+F6 move between workspace areas. Capture phase, so the keys also leave widgets
 * that swallow them, such as the terminal; a focused desktop browser forwards them instead.
 */
function WorkspaceFocusControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const router = useRouter();

  useEffect(() => startWorkspaceFocus(router), [router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]"))
        return;
      const command = resolveShortcutCommand(event, keybindings);
      if (command !== "workspace.focusNext" && command !== "workspace.focusPrevious") return;
      // Inside a dialog the move is refused, but the key is still consumed.
      event.preventDefault();
      event.stopPropagation();
      moveWorkspaceFocus(command === "workspace.focusNext" ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction?.((action) => {
      // The desktop browser's renderer focus is stale, so the move starts from the panel.
      if (action === "workspace.focusNext") moveWorkspaceFocus(1, "panel");
      if (action === "workspace.focusPrevious") moveWorkspaceFocus(-1, "panel");
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
    };
  }, [keybindings]);

  return null;
}

const APP_SIDEBAR_CONTAINER = '[data-slot="sidebar-container"][data-app-sidebar]';

/**
 * Board 10: entering focus fades the sidebar that was showing, drifting 8px
 * left over 200ms, while the layout snaps (the sidebar's width never animates).
 * Leaving focus brings it back at once. Opt-in panel animations already slide
 * it, so the fade stays out of their way.
 */
function useFocusEntrySidebarFade(focusModeActive: boolean, panelAnimationsActive: boolean) {
  // The width of the sidebar that showed when focus turned on, read before the collapse renders.
  const pendingWidthRef = useRef<number | null>(null);
  const fadeRef = useRef<TransientMotion | null>(null);
  useEffect(
    () =>
      useUiStateStore.subscribe((state, previous) => {
        if (!state.focusMode || previous.focusMode) return;
        const container = document.querySelector<HTMLElement>(APP_SIDEBAR_CONTAINER);
        const shown =
          container?.closest('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded";
        pendingWidthRef.current = container && shown ? container.offsetWidth : null;
      }),
    [],
  );
  // Every commit: the focus toggle re-renders this layout, so the next commit is its own.
  useLayoutEffect(() => {
    if (!focusModeActive) {
      fadeRef.current?.cancel();
      fadeRef.current = null;
    }
    const width = pendingWidthRef.current;
    pendingWidthRef.current = null;
    if (width === null || !focusModeActive || panelAnimationsActive || prefersReducedMotion()) {
      return;
    }
    const container = document.querySelector(APP_SIDEBAR_CONTAINER);
    if (!canAnimate(container) || !(container instanceof HTMLElement)) return;
    // While it fades it still sits over the content: it takes no clicks and
    // leaves the tab order until the fade ends.
    const wasInert = container.inert;
    container.inert = true;
    container.style.pointerEvents = "none";
    const release = () => {
      container.inert = wasInert;
      container.style.pointerEvents = "";
    };
    // Collapsed, the container sits a sidebar's width off screen; the fade starts where it was.
    const fade = playTransient(container, {
      opacity: [1, 0],
      transform: [`translateX(${width}px)`, `translateX(${width - 8}px)`],
      duration: MOTION_MS.state,
      ease: EASE_IN_OUT,
    });
    void fade.finished.then(release);
    fadeRef.current = {
      finished: fade.finished,
      cancel: () => {
        fade.cancel();
        release();
      },
    };
  });
  useEffect(() => () => fadeRef.current?.cancel(), []);
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  // Settings routes show the settings nav in place of whichever thread
  // sidebar is active.
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  // App-level pages that are not about a thread swap the sidebar for the slim navigation rail.
  // Narrow windows keep the sheet sidebar, which already carries the same destinations.
  const isMobile = useIsMobile();
  const showsRail = showsAppNavRail(pathname) && !isMobile;
  // Focus mode renders the thread sidebar collapsed but keeps it mounted (it owns next and
  // previous thread), and never writes its open state, so exit restores it as it was.
  const focusModeActive = useFocusModeActive() && !showsRail;
  useFocusEntrySidebarFade(focusModeActive, routePanelAnimationsActive);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // Subscribed rather than read once: the clamp must track live window size,
  // and a clamped drag ends with an unchanged width, which skips the re-render
  // that would otherwise refresh a render-time snapshot.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth);
  const resetSidebarWidth = () => {
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  // Window-fixed controls follow the floating sidebar's header in by a panel
  // gap. On macOS the desktop shell moves the traffic lights by the same inset
  // (apps/desktop/src/window/DesktopWindow.ts), so the controls stay beside them.
  // The sidebar header's content starts 16px into the panel (board 1), or past the
  // traffic lights where they sit over it.
  const controlsPlacement: Record<string, string> =
    isMacosDesktop && !isWindowFullscreen
      ? {
          "--workspace-controls-left": `calc(${MACOS_TRAFFIC_LIGHTS_LEFT_INSET} + var(--floating-controls-left))`,
          "--workspace-controls-top": "var(--floating-controls-top)",
          "--sidebar-header-inset": MACOS_TRAFFIC_LIGHTS_LEFT_INSET,
        }
      : {
          "--workspace-controls-top": "var(--floating-controls-top)",
          "--sidebar-header-inset": "1rem",
        };
  const sidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...controlsPlacement,
    // Focus mode has no sidebar control to make room for (board 3); the header keeps only its
    // usual inset, or the window controls' where they sit at the left.
    ...(focusModeActive
      ? { "--workspace-titlebar-content-left": "max(1.25rem, var(--workspace-controls-left))" }
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
        className="h-dvh! min-h-0! bg-(--app-window-background)"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        defaultOpen
        // The rail cannot be hidden, so the layout reads as an open sidebar while it shows. The
        // thread sidebar's own open state is left as the reader set it.
        {...(showsRail ? { open: true } : {})}
        {...(focusModeActive ? { open: false, onOpenChange: ignoreSidebarOpenChange } : {})}
        style={sidebarProviderStyle}
      >
        <ProjectProjectionRetention />
        <WorkspaceFocusControl />
        {showsRail ? (
          <AppNavRail
            electron={isElectron}
            reserveWindowControls={isMacosDesktop && !isWindowFullscreen}
            settingsShortcut={isElectron ? (isMacosDesktop ? "⌘," : "Ctrl+,") : null}
          />
        ) : (
          <Sidebar
            side="left"
            variant="floating"
            collapsible="offcanvas"
            {...workspaceAreaProps("sidebar", 0, "Sidebar")}
            data-app-sidebar=""
            className="text-sidebar-foreground"
            resizable={{
              maxWidth: sidebarMaximumWidth,
              minWidth: THREAD_SIDEBAR_MIN_WIDTH,
              shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
                nextWidth <= currentWidth ||
                wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
              storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
              onResize: setSidebarWidth,
            }}
          >
            {isOnSettings ? (
              // Board 6: the settings nav opens on "Back to threads", without the app title strip.
              <SettingsSidebarNav pathname={pathname} />
            ) : legacySidebarEnabled ? (
              <LegacyThreadSidebar />
            ) : (
              <ThreadSidebar />
            )}
            <SidebarRail onDoubleClick={resetSidebarWidth} />
          </Sidebar>
        )}
        {children}
        {showsRail || focusModeActive ? null : <SidebarControl />}
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
