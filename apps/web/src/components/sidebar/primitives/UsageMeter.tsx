import { cn } from "~/lib/utils";
import { resolveUsage } from "./metrics";

export function UsageMeter({
  label,
  percent,
  className,
}: {
  label: string;
  percent: number | null;
  className?: string;
}) {
  const usage = resolveUsage(percent);
  const color =
    usage.severity === "error"
      ? "var(--state-error)"
      : usage.severity === "warning"
        ? "var(--state-approval)"
        : "var(--sb-muted)";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-(length:--sb-text-meta) text-sb-muted",
        className,
      )}
    >
      <span>{label}</span>
      {usage.percent === null ? (
        <span aria-label={`${label}: no usage source`}>No source</span>
      ) : (
        <>
          <span
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usage.percent}
            className="h-1 w-12 overflow-hidden rounded-full bg-sb-hover"
          >
            <span
              className="block h-full"
              style={{ width: `${usage.percent}%`, backgroundColor: color }}
            />
          </span>
          <span className="font-mono tabular-nums" style={{ color }}>
            {Math.round(usage.percent)}%
          </span>
        </>
      )}
    </span>
  );
}
