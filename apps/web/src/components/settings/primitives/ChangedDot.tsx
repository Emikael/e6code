import { cn } from "~/lib/utils";

export function ChangedDot({
  label = "Changed from default",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-block size-1.5 shrink-0 rounded-full bg-sb-accent", className)}
    />
  );
}
