import type { EnvironmentConnectionPhase } from "@e6tools/client-runtime/connection";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** Canonical connection-phase → dot color mapping shared by every status dot. */
export function connectionPhaseDotClassName(phase: EnvironmentConnectionPhase): string {
  switch (phase) {
    case "connected":
      return "bg-success";
    case "connecting":
    case "reconnecting":
      return "bg-warning";
    case "error":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

/** Static halo for transitional phases; null renders no halo. */
export function connectionPhaseHaloClassName(phase: EnvironmentConnectionPhase): string | null {
  return phase === "connecting" || phase === "reconnecting" ? "ring-2 ring-warning/30" : null;
}

type ConnectionStatusDotProps = {
  tooltipText?: string | null;
  dotClassName: string;
  /** Ring classes marking an in-progress or live state. Static: no looping animation. */
  haloClassName?: string | null;
};

export function ConnectionStatusDot({
  tooltipText,
  dotClassName,
  haloClassName,
}: ConnectionStatusDotProps) {
  const dotContent = (
    <span className={cn("relative inline-flex size-2 rounded-full", dotClassName, haloClassName)} />
  );

  if (!tooltipText) {
    return (
      <span className="relative flex size-3 shrink-0 items-center justify-center">
        {dotContent}
      </span>
    );
  }

  const dot = (
    <button
      type="button"
      aria-label={tooltipText}
      className="relative flex size-3 shrink-0 cursor-help items-center justify-center rounded-full outline-hidden"
    >
      {dotContent}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={dot} />
      <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap leading-tight">
        {tooltipText}
      </TooltipPopup>
    </Tooltip>
  );
}
