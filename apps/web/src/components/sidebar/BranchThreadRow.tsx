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
  actions?: ReactNode;
  actionsVisible?: boolean;
  selected?: boolean;
  planProgress?: { step: string; completedSteps: number; totalSteps: number } | null | undefined;
  lastError?: string | null | undefined;
}

export function BranchThreadRow({
  title,
  status,
  age,
  meta,
  actions,
  actionsVisible = false,
  selected = false,
  planProgress,
  lastError,
}: BranchThreadRowProps) {
  return (
    <div
      data-sb-thread-content
      className={cn(
        "group/sidebar-row relative flex h-12 min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sb-foreground hover:bg-sb-hover",
        (lastError || planProgress) && "h-[68px]",
        selected && "bg-sb-selection hover:bg-sb-selection",
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
        <span
          className={cn(
            "shrink-0 font-mono text-(length:--sb-text-meta) text-sb-muted tabular-nums",
            actions && "group-focus-within/sidebar-row:hidden group-hover/sidebar-row:hidden",
            actions && actionsVisible && "hidden",
          )}
        >
          {age}
        </span>
        {actions && (
          <div
            className={cn(
              "sb-row-actions -my-[3px] -mr-[5px] shrink-0 items-center group-focus-within/sidebar-row:inline-flex group-hover/sidebar-row:inline-flex",
              actionsVisible ? "inline-flex" : "hidden",
            )}
          >
            {actions}
          </div>
        )}
      </div>
      <div className="flex h-4 min-w-0 items-center gap-1.5 text-(length:--sb-text-meta) leading-4 text-sb-muted @max-[280px]/sidebar-column:[&_[data-sb-model]]:sr-only @max-[360px]/sidebar-column:[&_[data-sb-environment-label]]:sr-only">
        {meta}
      </div>
      {lastError ? (
        <div className="mt-0.5 h-4 truncate text-(length:--sb-text-meta) leading-4 text-(--state-error)">
          {lastError}
        </div>
      ) : planProgress ? (
        <PlanProgress
          completed={planProgress.completedSteps}
          total={planProgress.totalSteps}
          currentStep={planProgress.step}
          className="mt-0.5 h-4 leading-4"
        />
      ) : null}
      {/* Last in the DOM so the row's name starts with its title; placed on the lane line. */}
      <span className="absolute top-[7px] -left-[17px] flex size-4 items-center justify-center bg-sb-surface">
        <StatusGlyph status={status} />
      </span>
    </div>
  );
}
