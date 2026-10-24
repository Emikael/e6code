import { cn } from "~/lib/utils";
import { normalizeCount } from "./metrics";
import type { SwitchboardStatus } from "./status";

export function CountBadge({
  count,
  label,
  status,
  decorative = false,
  className,
}: {
  count: number;
  label: string;
  status?: SwitchboardStatus;
  /** Hide from assistive tech when a surrounding label already states the count. */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": `${normalizeCount(count) ?? 0} ${label}` })}
      className={cn(
        "inline-flex min-w-4 items-center justify-center rounded-[5px] bg-sb-hover px-1 font-mono text-(length:--sb-text-meta) text-sb-muted tabular-nums",
        className,
      )}
      style={status ? { color: `var(--state-${status})` } : undefined}
    >
      {normalizeCount(count) ?? 0}
    </span>
  );
}
