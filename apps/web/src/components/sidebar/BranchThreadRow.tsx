import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { PlanProgress } from "./primitives/PlanProgress";
import { StatusGlyph } from "./primitives/StatusGlyph";
import type { SwitchboardStatus } from "./primitives/status";

export interface BranchThreadRowProps {
  title: ReactNode;
  status: SwitchboardStatus;
  age: ReactNode;
  meta: ReactNode;
  /** How many 24px actions `BranchThreadRowActions` shows beside the option.
   * The age yields to them, and the title line keeps their width free. */
  actionCount?: number;
  actionsVisible?: boolean;
  selected?: boolean;
  planProgress?: { step: string; completedSteps: number; totalSteps: number } | null | undefined;
  lastError?: string | null | undefined;
  /** Compact keeps one 28px line: glyph, title, diff stat and age. */
  density?: "comfortable" | "compact";
  /** The diff stat for the compact line; comfortable rows show it in `meta`. */
  diffStat?: ReactNode;
}

/** The visible row inside a thread option. Only the title reaches the option's
 * name: the rest is aria-hidden, so the option describes status separately. */
export function BranchThreadRow({
  title,
  status,
  age,
  meta,
  actionCount = 0,
  actionsVisible = false,
  selected = false,
  planProgress,
  lastError,
  density = "comfortable",
  diffStat,
}: BranchThreadRowProps) {
  const compact = density === "compact";
  return (
    <div
      data-sb-thread-content
      data-sb-density={density}
      className={cn(
        "group/sidebar-row relative flex min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sb-foreground hover:bg-sb-hover group-hover/sidebar-row:bg-sb-hover",
        compact ? "h-7 py-[5px]" : lastError || planProgress ? "h-[68px]" : "h-12",
        selected && "bg-sb-selection hover:bg-sb-selection group-hover/sidebar-row:bg-sb-selection",
      )}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[3px] bottom-[3px] -left-[10px] w-0.5 rounded-full bg-sb-accent"
        />
      )}
      <div className="flex h-[18px] min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center truncate text-(length:--sb-text-body) leading-[18px] font-medium">
          {title}
        </div>
        {compact &&
          diffStat && (
            // Narrow columns give the diff stat's room to the hover actions.
            <span
              className={cn(
                "shrink-0",
                actionCount > 0 &&
                  "@max-[280px]/sidebar-column:group-focus-within/sidebar-row:hidden @max-[280px]/sidebar-column:group-hover/sidebar-row:hidden",
                actionCount > 0 && actionsVisible && "@max-[280px]/sidebar-column:hidden",
              )}
            >
              {diffStat}
            </span>
          )}
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 font-mono text-(length:--sb-text-meta) text-sb-muted tabular-nums",
            actionCount > 0 &&
              "group-focus-within/sidebar-row:hidden group-hover/sidebar-row:hidden",
            actionCount > 0 && actionsVisible && "hidden",
            "[[data-sb-dragging]_&]:inline",
          )}
        >
          {age}
        </span>
        {actionCount > 0 && (
          // The actions overlap the row's 5px right padding, as they did in flow.
          <span
            aria-hidden="true"
            style={{ width: actionCount * 24 - 5 }}
            className={cn(
              "shrink-0 group-focus-within/sidebar-row:block group-hover/sidebar-row:block",
              actionsVisible ? "block" : "hidden",
              "[[data-sb-dragging]_&]:hidden",
            )}
          />
        )}
      </div>
      {!compact && (
        <div className="flex h-4 min-w-0 items-center gap-1.5 text-(length:--sb-text-meta) leading-4 text-sb-muted @max-[280px]/sidebar-column:[&_[data-sb-model]]:sr-only @max-[360px]/sidebar-column:[&_[data-sb-environment-label]]:sr-only">
          {meta}
        </div>
      )}
      {compact ? null : lastError ? (
        <div
          aria-hidden="true"
          className="mt-0.5 h-4 truncate text-(length:--sb-text-meta) leading-4 text-(--state-error)"
        >
          {lastError}
        </div>
      ) : planProgress ? (
        <div aria-hidden="true" className="mt-0.5 min-w-0">
          <PlanProgress
            completed={planProgress.completedSteps}
            total={planProgress.totalSteps}
            currentStep={planProgress.step}
            className="h-4 leading-4"
          />
        </div>
      ) : null}
      {/* Placed on the lane line. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute -left-[17px] flex size-4 items-center justify-center bg-sb-surface",
          compact ? "top-[6px]" : "top-[7px]",
        )}
      >
        <StatusGlyph status={status} />
      </span>
    </div>
  );
}

/** Pointer shortcuts for the row's context menu, beside the thread option: an
 * option may not hold interactive content. Render inside the row's
 * `group/sidebar-row` item, which reveals them on hover or focus over the age.
 * A listbox also counts everything in its groups as its own children, so the
 * shortcuts stay out of the accessibility tree, never take focus, and keyboard
 * users reach the same actions through the context menu (tab stops are C10). */
export function BranchThreadRowActions({
  visible = false,
  density = "comfortable",
  children,
}: {
  visible?: boolean;
  density?: "comfortable" | "compact";
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      // A pointer press must not move focus into the hidden actions.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "sb-row-actions absolute right-[3px] items-center group-focus-within/sidebar-row:inline-flex group-hover/sidebar-row:inline-flex",
        density === "compact" ? "top-[2px]" : "top-[3px]",
        visible ? "inline-flex" : "hidden",
        "[[data-sb-dragging]_&]:hidden",
      )}
    >
      {children}
    </div>
  );
}
