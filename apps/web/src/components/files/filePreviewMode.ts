import { isAbsolutePath } from "~/terminal-links";

export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

/** Below this panel width the Files tab folds its explorer into a header button. */
export const FILE_EXPLORER_COLUMN_MIN_PANEL_WIDTH = 640;

/**
 * Where the workspace tree goes beside a file. "fill": nothing is open, so the tree is the
 * surface. "column": beside the file. "overlay": over the file, opened from the header button
 * in a narrow Files tab. "none": hidden, or there is no workspace tree for this file (an
 * attachment, a host file). The Files tab always shows its explorer when there is room; a file
 * kept as its own tab starts without one, so two trees never show at once.
 */
export type FileExplorerLayout = "none" | "fill" | "column" | "overlay";

export function resolveFileExplorerLayout(input: {
  readonly variant: "files" | "kept";
  readonly relativePath: string | null;
  readonly attachmentOpen: boolean;
  /** The panel is narrower than FILE_EXPLORER_COLUMN_MIN_PANEL_WIDTH. */
  readonly narrow: boolean;
  /** The header button's state: the overlay in a narrow Files tab, the column in a kept tab. */
  readonly explorerOpen: boolean;
}): FileExplorerLayout {
  if (input.attachmentOpen || (input.relativePath && isAbsolutePath(input.relativePath))) {
    return "none";
  }
  if (input.relativePath === null) return "fill";
  if (input.variant === "files" && !input.narrow) return "column";
  if (!input.explorerOpen) return "none";
  return input.narrow ? "overlay" : "column";
}

/** Whether the header offers the button that shows or hides the explorer. */
export function fileExplorerToggleShown(input: {
  readonly variant: "files" | "kept";
  readonly narrow: boolean;
}): boolean {
  return input.variant === "kept" || input.narrow;
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}
