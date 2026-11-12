import type {
  KeybindingShortcut,
  PreviewSessionSnapshot,
  PullRequestState,
} from "@e6tools/contracts";
import { isMacPlatform } from "@e6tools/shared/keybindings";

import type { RightPanelSurface } from "~/rightPanelStore";
import { PULL_REQUEST_STATE_PRESENTATION } from "./pullRequest/pullRequestIcons";

/** What a tab label can say about its surface beyond its name. Absent fields say nothing. */
export interface SurfaceTitleState {
  /** Files changed in the working tree, for the Diff tab. */
  readonly changedFileCount?: number;
  /** Terminals with a running process, for terminal tabs. */
  readonly runningTerminalIds?: ReadonlySet<string>;
  /** Terminals whose process stopped while out of view, until they are looked at. */
  readonly finishedTerminalIds?: ReadonlySet<string>;
  /** The resolved lifecycle of a pull request tab, once known. */
  readonly pullRequestStatus?: {
    readonly state: PullRequestState;
    readonly isDraft: boolean;
  } | null;
}

/** How many of a terminal tab's panes have a running process. Zero for other surfaces. */
export function runningTerminalCount(
  surface: RightPanelSurface,
  runningTerminalIds: ReadonlySet<string> | undefined,
): number {
  if (surface.kind !== "terminal" || !runningTerminalIds || runningTerminalIds.size === 0) {
    return 0;
  }
  return surface.terminalIds.filter((terminalId) => runningTerminalIds.has(terminalId)).length;
}

/** A tab's name and, apart, its state in words, so a strip can truncate the name alone. */
export interface SurfaceTitleParts {
  readonly name: string;
  /** "5 files", "Open", "1 running"; null when the tab has nothing to say. */
  readonly state: string | null;
}

/** The parts of `surfaceTitle`, for a label that must keep its state visible when space runs out. */
export function surfaceTitleParts(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  // Terminal tabs are named "Terminal" (board 16); a pane's own label is in its header.
  _terminalLabelsById: ReadonlyMap<string, string>,
  state: SurfaceTitleState = {},
): SurfaceTitleParts {
  switch (surface.kind) {
    case "diff": {
      const count = state.changedFileCount ?? 0;
      return {
        name: "Diff",
        state: count > 0 ? `${count} ${count === 1 ? "file" : "files"}` : null,
      };
    }
    case "files":
      return { name: "Files", state: null };
    case "file":
      return {
        name: surface.relativePath.slice(
          Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) +
            1,
        ),
        state: null,
      };
    case "terminal": {
      // Board 16: "Terminal · 1 running", "Terminal · Finished", or "Terminal". Each pane's own
      // label is in its header.
      const running = runningTerminalCount(surface, state.runningTerminalIds);
      if (running > 0) return { name: "Terminal", state: `${running} running` };
      const finished = surface.terminalIds.some((terminalId) =>
        state.finishedTerminalIds?.has(terminalId),
      );
      return { name: "Terminal", state: finished ? "Finished" : null };
    }
    case "pull-request": {
      const status = state.pullRequestStatus;
      if (!status) return { name: `#${surface.number}`, state: null };
      const key = status.state === "open" && status.isDraft ? "draft" : status.state;
      return { name: `#${surface.number}`, state: PULL_REQUEST_STATE_PRESENTATION[key].label };
    }
    case "pull-requests":
      return { name: "Pull requests", state: null };
    case "device":
      return { name: surface.title ?? surface.target?.name ?? "Device", state: null };
    case "preview":
      return { name: previewTitle(surface, sessions), state: null };
  }
}

function previewTitle(
  surface: Extract<RightPanelSurface, { kind: "preview" }>,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string {
  const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
  if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
  if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
  try {
    return new URL(snapshot.navStatus.url).host || "Browser";
  } catch {
    return "Browser";
  }
}

/**
 * A tab's name, followed by its state in words when `state` carries it: "Diff · 5 files",
 * "#412 · Open", "Terminal 1 · 1 running". Without `state` it is the bare name, used where the
 * name stands alone, such as "Close Diff".
 */
export function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
  state: SurfaceTitleState = {},
): string {
  const parts = surfaceTitleParts(surface, sessions, terminalLabelsById, state);
  return parts.state ? `${parts.name} · ${parts.state}` : parts.name;
}

/** A tab's horizontal extent, in the same coordinates as the strip that shows it. */
export interface TabExtent {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

const TAB_VISIBILITY_TOLERANCE = 1;

/**
 * The tabs a strip from `viewportStart` to `viewportEnd` does not fully show, in tab order.
 * A tab cut by an edge counts as hidden: its label cannot be read.
 */
export function tabsOutOfView(
  tabs: readonly TabExtent[],
  viewportStart: number,
  viewportEnd: number,
): string[] {
  return tabs
    .filter(
      (tab) =>
        tab.start < viewportStart - TAB_VISIBILITY_TOLERANCE ||
        tab.end > viewportEnd + TAB_VISIBILITY_TOLERANCE,
    )
    .map((tab) => tab.id);
}

/** The overflow button's words: "3 more", or "3 more · 1 running" when a hidden tab runs. */
export function overflowMenuLabel(
  hiddenCount: number,
  runningCount: number,
): { text: string; ariaLabel: string } {
  const tabs = hiddenCount === 1 ? "tab" : "tabs";
  if (runningCount > 0) {
    return {
      text: `${hiddenCount} more · ${runningCount} running`,
      ariaLabel: `${hiddenCount} more ${tabs}, ${runningCount} running`,
    };
  }
  return { text: `${hiddenCount} more`, ariaLabel: `${hiddenCount} more ${tabs}` };
}

/**
 * A closable tab's `aria-keyshortcuts`: Delete, Backspace (a Mac laptop's delete key), then the
 * close-tab shortcut when one is bound, written as ARIA spells modifiers ("Meta+W", "Control+W").
 */
export function closeTabKeyShortcuts(
  closeShortcut: KeybindingShortcut | null,
  platform: string,
): string {
  const keys = ["Delete", "Backspace"];
  if (closeShortcut) {
    const useMetaForMod = isMacPlatform(platform);
    const parts: string[] = [];
    if (closeShortcut.ctrlKey || (closeShortcut.modKey && !useMetaForMod)) parts.push("Control");
    if (closeShortcut.altKey) parts.push("Alt");
    if (closeShortcut.shiftKey) parts.push("Shift");
    if (closeShortcut.metaKey || (closeShortcut.modKey && useMetaForMod)) parts.push("Meta");
    const key = closeShortcut.key;
    parts.push(key.length === 1 ? key.toUpperCase() : key.slice(0, 1).toUpperCase() + key.slice(1));
    keys.push(parts.join("+"));
  }
  return keys.join(" ");
}
