import { cn } from "~/lib/utils";
import { SWITCHBOARD_STATUS, type SwitchboardStatus } from "./status";

export function StatusGlyph({
  status,
  className,
}: {
  status: SwitchboardStatus;
  className?: string;
}) {
  const { icon: Icon, label } = SWITCHBOARD_STATUS[status];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0", className)}
      style={{ color: `var(--state-${status})` }}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
    </span>
  );
}
