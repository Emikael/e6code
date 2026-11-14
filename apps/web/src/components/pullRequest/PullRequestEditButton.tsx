import { PencilIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

/** An Edit affordance, always visible so editing never depends on hover. */
export function PullRequestEditButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "render" | "size" | "variant"> & {
  "aria-label": string;
}) {
  return (
    <Button
      {...props}
      size="icon-xs"
      variant="ghost"
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <PencilIcon aria-hidden className="size-3" />
    </Button>
  );
}
