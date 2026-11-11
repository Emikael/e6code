import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The one header every right panel surface uses, so switching tabs never changes its shape:
 * 36px with a bottom border, context on the left, then `actions` on the right (at most two
 * labelled buttons and one More menu). It replaced a 28px borderless row to make room for
 * 24px targets and labelled buttons.
 */
export function PanelSurfaceHeader({
  actions,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      data-surface-subheader
      {...props}
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-1",
        className,
      )}
    >
      {children}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}
