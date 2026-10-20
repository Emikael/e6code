import { cn } from "~/lib/utils";
import { SWITCHBOARD_STATUS, type SwitchboardStatus } from "./status";

export function StatusPill({
  status,
  className,
  label,
}: {
  status: SwitchboardStatus;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-[5px] px-1.5 py-0.5 text-(length:--sb-text-meta) leading-none",
        className,
      )}
      style={{
        color: `var(--state-${status})`,
        backgroundColor: `color-mix(in srgb, var(--state-${status}) 10%, var(--sb-surface))`,
      }}
    >
      {label ?? SWITCHBOARD_STATUS[status].label}
    </span>
  );
}
