import type * as React from "react";

import { cn } from "~/lib/utils";

function Kbd({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"kbd"> & { variant?: "default" | "switchboard" }) {
  return (
    <kbd
      className={cn(
        variant === "switchboard"
          ? "pointer-events-none inline-flex h-4 min-w-4 select-none items-center justify-center gap-1 rounded-[5px] border border-sb-border bg-sb-hover px-1 font-mono text-(length:--sb-text-meta) text-sb-muted tabular-nums [&_svg]:size-3"
          : "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded bg-muted px-1 font-medium font-sans text-muted-foreground text-xs [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
