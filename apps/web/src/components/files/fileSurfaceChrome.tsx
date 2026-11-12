import type { ReactNode } from "react";

import { PanelErrorCard } from "~/components/panel/PanelErrorCard";
import { Spinner } from "~/components/ui/spinner";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { DIFF_SURFACE_THEME_UNSAFE_CSS } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";

export const FILE_LINK_REVEAL_ATTRIBUTE = "data-file-link-reveal";

export const FILE_LINK_REVEAL_UNSAFE_CSS = `
  ${DIFF_SURFACE_THEME_UNSAFE_CSS}

  diffs-container {
    --diffs-bg: var(--code-background, var(--background)) !important;
    --diffs-light-bg: var(--code-background, var(--background)) !important;
    --diffs-dark-bg: var(--code-background, var(--background)) !important;
    background-color: var(--code-background, var(--background)) !important;
    color: var(--code-foreground, var(--foreground)) !important;
  }

  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-line] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 82%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      )
    ) !important;
  }

  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-column-number] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 60%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      )
    ) !important;
    color: var(--diffs-selection-number-fg) !important;
  }

  /* Selected lines: the primary-surface wash laid over the line, with a primary-edge line, not a
     wash alone (a wash measured 1.15:1). */
  :is([data-line], [data-column-number])[data-selected-line] {
    background-image: linear-gradient(var(--primary-surface), var(--primary-surface)) !important;
  }
  [data-column-number][data-selected-line] {
    box-shadow: inset 2px 0 0 var(--primary-edge) !important;
  }
`;

/**
 * An icon-only header action with its label in a tooltip, the same control workspace files use.
 * A `pressed` action is a toggle and says so; a command (Copy, Save, Close) is a plain button,
 * because announcing it as an unpressed toggle tells a screen reader it has a state it has not.
 */
export function FileSurfaceAction(props: {
  readonly label: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  const pressed = props.pressed;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          pressed === undefined ? (
            <Button
              type="button"
              className="shrink-0"
              disabled={props.disabled ?? false}
              onClick={props.onPress}
              aria-label={props.label}
              variant="ghost"
              size="icon-sm"
            >
              {props.children}
            </Button>
          ) : (
            <Toggle
              className="shrink-0"
              pressed={pressed}
              disabled={props.disabled ?? false}
              onPressedChange={props.onPress}
              aria-label={props.label}
              variant="ghost"
              size="sm"
            >
              {props.children}
            </Toggle>
          )
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function FileSurfaceNotice(props: { readonly children: ReactNode }) {
  return (
    <div
      role="status"
      className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-[11px] text-warning-foreground"
    >
      {props.children}
    </div>
  );
}

export function FileSurfaceLoading(props: { readonly className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading file"
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center text-muted-foreground",
        props.className,
      )}
    >
      <Spinner className="size-5" />
    </div>
  );
}

/** Board 14's error card, centred where the file would be: what failed, that the file is safe, Retry. */
export function FileSurfaceFailure(props: {
  readonly message: string;
  readonly title?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md">
        <PanelErrorCard
          title={props.title ?? "Could not show this file"}
          reason={props.message}
          reassurance="The file is not affected."
          onRetry={props.onRetry}
        />
      </div>
    </div>
  );
}
