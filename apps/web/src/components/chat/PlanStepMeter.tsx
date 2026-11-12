import { useLayoutEffect, useRef } from "react";

import { newlyCompletedSegments, playMoment, type PlanMeterWatch } from "~/lib/motion";
import { cn } from "~/lib/utils";
import { planSegments } from "./DraftHeroFooter.logic";

/**
 * The plan step meter: finished steps, the running one, then the rest. Empty
 * segments keep a hairline edge so the track stays visible. Labelled with the
 * step position, since the segments alone are colour.
 *
 * With `fillKey` (the open thread's key), a step completing while you watch
 * fills its segment from the left (board 10). Without it the meter never moves.
 */
export function PlanStepMeter({
  progress,
  fillKey,
}: {
  progress: { readonly completedSteps: number; readonly totalSteps: number };
  fillKey?: string;
}) {
  const meterRef = useRef<HTMLSpanElement>(null);
  const watchRef = useRef<PlanMeterWatch | null>(null);
  const { completedSteps, totalSteps } = progress;
  useLayoutEffect(() => {
    if (fillKey === undefined) return;
    const next = { key: fillKey, completedSteps, totalSteps };
    const fill = newlyCompletedSegments(watchRef.current, next);
    watchRef.current = next;
    if (!fill) return;
    const filled = Array.from(meterRef.current?.children ?? []).slice(fill.from, fill.to);
    const motions = filled.map((segment) => playMoment(segment, "fill"));
    return () => {
      for (const motion of motions) motion?.cancel();
    };
  }, [completedSteps, fillKey, totalSteps]);

  const segments = planSegments(progress);
  if (segments.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={`Step ${Math.min(progress.completedSteps + 1, progress.totalSteps)} of ${progress.totalSteps}`}
      className="flex shrink-0 gap-[3px]"
      ref={meterRef}
    >
      {segments.map((segment, index) => (
        <span
          // Segments have no identity beyond their position.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={cn(
            "h-1.5 w-3.5 origin-left rounded-full",
            segment === "done"
              ? "bg-success"
              : segment === "live"
                ? "bg-primary"
                : "ring-1 ring-muted-foreground ring-inset",
          )}
        />
      ))}
    </span>
  );
}
