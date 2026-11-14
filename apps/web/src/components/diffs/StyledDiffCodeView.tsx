/* oxlint-disable eslint/no-restricted-imports -- This is the single styled adapter around Pierre's raw viewer. */
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewProps,
  type ControlledCodeViewProps,
} from "@pierre/diffs/react";
/* oxlint-enable eslint/no-restricted-imports */
import { type Ref, useMemo } from "react";

import { DIFF_SURFACE_THEME_UNSAFE_CSS, plainFileDiff } from "~/lib/diffRendering";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";

// Pierre draws selected lines and the comment button in its "modified" blue. They take the
// primary edge instead, as every selection in the app does: hue is kept for status.
const DIFF_VIEW_UNSAFE_CSS = `${DIFF_SURFACE_THEME_UNSAFE_CSS}
:host {
  --diffs-modified-color-override: var(--primary-edge);
}

:is(
  [data-line],
  [data-line-annotation],
  [data-merge-conflict],
  [data-merge-conflict-actions],
  [data-no-newline]
)[data-selected-line] {
  --diffs-line-bg: light-dark(
    color-mix(
      in lab,
      var(--code-background) 88%,
      color-mix(in srgb, var(--code-background) 50%, var(--diffs-modified-base))
    ),
    color-mix(
      in lab,
      var(--code-background) 80%,
      color-mix(in srgb, var(--code-background) 70%, var(--diffs-modified-base))
    )
  ) !important;
}

:is([data-gutter-buffer], [data-column-number])[data-selected-line] {
  --diffs-line-bg: light-dark(
    color-mix(
      in lab,
      var(--code-background) 91%,
      color-mix(in srgb, var(--code-background) 35%, var(--diffs-modified-base))
    ),
    color-mix(
      in lab,
      var(--code-background) 85%,
      color-mix(in srgb, var(--code-background) 60%, var(--diffs-modified-base))
    )
  ) !important;
}

[data-indicators="bars"]
  :is([data-column-number], [data-gutter-buffer="annotation"])[data-selected-line] {
  position: relative;
}

[data-indicators="bars"]
  :is([data-column-number], [data-gutter-buffer="annotation"])[data-selected-line]::before {
  position: absolute !important;
  inset-block: 0 !important;
  inset-inline-start: 0 !important;
  display: block !important;
  width: 4px !important;
  min-width: 4px !important;
  max-width: 4px !important;
  height: auto !important;
  padding: 0 !important;
  content: "" !important;
  background-color: var(--diffs-modified-base) !important;
  background-image: none !important;
}

[data-file-info] {
  background-color: var(--code-background) !important;
  border-block-color: transparent !important;
  color: var(--code-foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--code-background) !important;
  border-bottom-color: transparent !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
  line-height: 1 !important;
  min-height: 32px !important;
  padding-block: 6px !important;
  padding-inline: 8px 12px !important;
}

[data-diffs-header]:hover {
  /* A native scrollbar gutter cannot be painted by descendants. Use an inset edge cue instead
     of a full-width band that would look accidentally clipped at the gutter. */
  background-color: var(--code-background) !important;
  box-shadow: inset 3px 0 color-mix(in srgb, var(--code-foreground) 24%, transparent);
}

/* Each hunk opens with its header ("@@ name @@"), drawn as one more quiet line of the diff where
   the code text starts (board 12). The viewer puts it in place of its "N unmodified lines" row,
   which still expands the hidden lines when clicked. */
:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  height: 20px !important;
  margin-block: 0 !important;
  background-color: var(--code-background) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-separator-wrapper] {
  /* The row is drawn from the line-number column, which is its containing block, across the
     code: a full column width plus the code's own 2ch inset lands on the code text. */
  padding-inline: calc(100% + 2ch) 12px !important;
  background-color: transparent !important;
  font-family: var(--diffs-font-family) !important;
  font-size: var(--diffs-font-size, 13px) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-separator-content] {
  padding-inline: 0 !important;
  background-color: transparent !important;
  color: color-mix(in srgb, var(--code-foreground) 52%, var(--code-background)) !important;
  font: inherit !important;
  text-decoration: none !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-unmodified-lines] {
  display: block !important;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  [data-separator-wrapper] {
  grid-template-columns: 0 minmax(0, 1fr) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  [data-separator-content] {
  grid-column: 2 !important;
  cursor: pointer;
}

/* Visually hidden rather than display: none so the expand action stays keyboard-reachable. */
:is([data-separator="line-info"], [data-separator="line-info-basic"])
  [data-expand-button] {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  margin: -1px !important;
  padding: 0 !important;
  overflow: hidden !important;
  clip-path: inset(50%) !important;
  border: 0 !important;
  white-space: nowrap !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]):has(
    [data-expand-button]
  ):is(:hover, :focus-within)
  [data-separator-content] {
  color: color-mix(in srgb, var(--code-foreground) 76%, var(--code-background)) !important;
}

[data-diffs-header] [data-header-content] {
  align-items: center !important;
  line-height: 1 !important;
}

[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}

[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: 11px !important;
  font-variant-numeric: tabular-nums;
  line-height: 1 !important;
}

[data-diffs-header] [data-change-icon],
[data-diffs-header] [data-rename-icon] {
  display: block;
  flex-shrink: 0;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  font-family: var(--font-sans) !important;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--code-foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}

/* Expanding a file mounts its body all at once; easing it in matches the 200ms the app's
   collapsibles take. Appearance only — the viewer owns geometry, so height cannot animate.
   Departing content cuts, the same one-way rule the pull request chrome fold follows. */
[data-diff],
[data-file] {
  /* The Motion setting reaches into this shadow root through the inherited variable. */
  transition: var(--reduced-motion-transition, opacity 200ms ease-out);
}

@starting-style {
  [data-diff],
  [data-file] {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-diff],
  [data-file] {
    transition: none;
  }
}
`;

export type StyledDiffCodeViewOptions<LAnnotation> = Omit<
  NonNullable<CodeViewProps<LAnnotation>["options"]>,
  "unsafeCSS" | "itemMetrics" | "layout" | "lineDiffType"
>;

// Controlled only: the surface hands the viewer plain copies of the items it is given.
type StyledDiffCodeViewProps<LAnnotation> = Omit<
  ControlledCodeViewProps<LAnnotation>,
  "options"
> & {
  readonly options?: StyledDiffCodeViewOptions<LAnnotation>;
  readonly viewerRef?: Ref<CodeViewHandle<LAnnotation>>;
  /**
   * Appended to the shared stylesheet inside the viewer's shadow root, for a surface that has
   * to restyle chrome the viewer owns — such as replacing its per-file line counts.
   */
  readonly unsafeCSSExtra?: string;
  /** The height every file header takes, when the surface draws its own (32 by default). */
  readonly headerHeight?: number;
};

/**
 * The shared web CodeView surface: app styling and virtualized geometry stay paired here. Diffs
 * are drawn as board 12 draws them, plain +/− lines with no token colors, in the Diff tab and the
 * pull request's Code tab alike.
 */
export function StyledDiffCodeView<LAnnotation = undefined>({
  options,
  viewerRef,
  className,
  unsafeCSSExtra,
  headerHeight = 32,
  items,
  ...props
}: StyledDiffCodeViewProps<LAnnotation>) {
  const plainItems = useMemo(
    () =>
      items.map((item) =>
        item.type === "diff" ? { ...item, fileDiff: plainFileDiff(item.fileDiff) } : item,
      ),
    [items],
  );
  return (
    <DiffWorkerPoolProvider>
      <CodeView<LAnnotation>
        {...props}
        items={plainItems}
        {...(viewerRef ? { ref: viewerRef } : {})}
        // The custom element itself is focusable for keyboard scrolling. Its native outline sits
        // outside the panel clipping boundary; actual controls inside retain their own indicators.
        className={
          className
            ? `diff-render-surface [--code-background:var(--background)] outline-none ${className}`
            : "diff-render-surface [--code-background:var(--background)] outline-none"
        }
        options={{
          diffIndicators: "classic",
          ...options,
          // Whole +/− lines only: no changed words picked out inside a line (board 12).
          lineDiffType: "none",
          unsafeCSS: unsafeCSSExtra
            ? `${DIFF_VIEW_UNSAFE_CSS}\n${unsafeCSSExtra}`
            : DIFF_VIEW_UNSAFE_CSS,
          itemMetrics: {
            diffHeaderHeight: headerHeight,
            hunkSeparatorHeight: 20,
            // Pierre uses its general file spacing as a fallback in expanded-file layout paths.
            // Keep it zero alongside the explicit paddingTop or expanding the first file can
            // reintroduce the library's default 8px gap above its header.
            spacing: 0,
            paddingTop: 0,
            // Unlike the gap above, the 8px under a file's last line is painted
            // unconditionally by Pierre's stylesheet (`--diffs-gap-fallback`), so the metric has
            // to count it: at zero every expanded file's virtual height ran 8px short of its
            // rendered height, and the end of the list sat past the reachable scroll range —
            // one clipped file row per expanded file above it.
            paddingBottom: 8,
          },
          layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
        }}
      />
    </DiffWorkerPoolProvider>
  );
}
