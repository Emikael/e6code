import type { PreviewSessionSnapshot, PullRequestState } from "@e6tools/contracts";
import { getTerminalLabel } from "@e6tools/shared/terminalLabels";

import type { RightPanelSurface } from "~/rightPanelStore";
import { PULL_REQUEST_STATE_PRESENTATION } from "./pullRequest/pullRequestIcons";

/** What a tab label can say about its surface beyond its name. Absent fields say nothing. */
export interface SurfaceTitleState {
  /** Files changed in the working tree, for the Diff tab. */
  readonly changedFileCount?: number;
  /** Terminals with a running process, for terminal tabs. */
  readonly runningTerminalIds?: ReadonlySet<string>;
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
  switch (surface.kind) {
    case "diff": {
      const count = state.changedFileCount ?? 0;
      return count > 0 ? `Diff · ${count} ${count === 1 ? "file" : "files"}` : "Diff";
    }
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(
        Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1,
      );
    case "terminal": {
      const label =
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId);
      const running = runningTerminalCount(surface, state.runningTerminalIds);
      return running > 0 ? `${label} · ${running} running` : label;
    }
    case "pull-request": {
      const status = state.pullRequestStatus;
      if (!status) return `#${surface.number}`;
      const key = status.state === "open" && status.isDraft ? "draft" : status.state;
      return `#${surface.number} · ${PULL_REQUEST_STATE_PRESENTATION[key].label}`;
    }
    case "pull-requests":
      return "Pull requests";
    case "device":
      return surface.title ?? surface.target?.name ?? "Device";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
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
