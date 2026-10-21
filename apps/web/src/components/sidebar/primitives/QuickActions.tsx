import type { LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}

type QuickActionVariant = "default" | "row";

/** One icon action. Rows place these inside their own "Thread actions" group
 * when other controls sit between them. */
export function QuickActionButton({
  action: { label, icon: Icon, onClick, disabled, pressed },
  variant = "default",
}: {
  action: QuickAction;
  variant?: QuickActionVariant;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="chip" disabled={disabled} />}
        className={cn(
          "sb-action size-6 disabled:opacity-50",
          variant === "row" &&
            "min-h-6 text-sb-muted hover:bg-[color-mix(in_srgb,var(--sb-foreground)_8%,var(--sb-surface))] hover:text-sb-foreground",
        )}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <Icon
          aria-hidden="true"
          className={variant === "row" ? "size-3.5" : "size-3"}
          strokeWidth={1.75}
        />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function QuickActions({
  actions,
  variant = "default",
  className,
}: {
  actions: readonly QuickAction[];
  variant?: QuickActionVariant;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Thread actions"
      className={cn(
        "inline-flex items-center rounded-[5px]",
        variant === "default" && "gap-0.5 border border-sb-border bg-sb-surface p-0.5",
        className,
      )}
    >
      {actions.map((action) => (
        <QuickActionButton key={action.id} action={action} variant={variant} />
      ))}
    </div>
  );
}
