import { cn } from "~/lib/utils";
import { planSegments } from "./DraftHeroFooter.logic";

/**
 * The plan step meter: finished steps, the running one, then the rest. Empty
 * segments keep a hairline edge so the track stays visible. Labelled with the
 * step position, since the segments alone are colour.
 */
export function PlanStepMeter({
  progress,
}: {
  progress: { readonly completedSteps: number; readonly totalSteps: number };
}) {
  const segments = planSegments(progress);
  if (segments.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={`Step ${Math.min(progress.completedSteps + 1, progress.totalSteps)} of ${progress.totalSteps}`}
      className="flex shrink-0 gap-[3px]"
    >
      {segments.map((segment, index) => (
        <span
          // Segments have no identity beyond their position.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={cn(
            "h-1.5 w-3.5 rounded-full",
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
