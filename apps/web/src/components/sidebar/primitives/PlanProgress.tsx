import { cn } from "~/lib/utils";
import { resolvePlanProgress } from "./metrics";

export function PlanProgress({
  completed,
  total,
  currentStep,
  className,
}: {
  completed: number;
  total: number;
  currentStep?: string;
  className?: string;
}) {
  const progress = resolvePlanProgress(completed, total);
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-(length:--sb-text-meta) text-sb-muted",
        className,
      )}
    >
      <span
        role="progressbar"
        aria-label="Plan progress"
        aria-valuemin={0}
        aria-valuemax={progress.total || 1}
        aria-valuenow={progress.completed}
        aria-valuetext={`${progress.completed} of ${progress.total} steps completed`}
        className="relative h-1 w-16 shrink-0 overflow-hidden bg-sb-hover"
      >
        <span
          className="block h-full"
          style={{ width: `${progress.percent}%`, backgroundColor: "var(--state-working)" }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, transparent calc(100% - 2px), var(--sb-surface) calc(100% - 2px))",
            backgroundSize: `${100 / (progress.total || 1)}% 100%`,
          }}
        />
      </span>
      {currentStep && <span className="truncate">{currentStep}</span>}
      <span className="ml-auto shrink-0 font-mono tabular-nums">
        {progress.completed}/{progress.total}
      </span>
    </span>
  );
}
