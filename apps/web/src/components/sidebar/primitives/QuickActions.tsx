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

export function QuickActions({
  actions,
  className,
}: {
  actions: readonly QuickAction[];
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Thread actions"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[5px] border border-sb-border bg-sb-surface p-0.5",
        className,
      )}
    >
      {actions.map(({ id, label, icon: Icon, onClick, disabled, pressed }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={<Button variant="chip" disabled={disabled} />}
            className="sb-action size-6 disabled:opacity-50"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          >
            <Icon aria-hidden="true" className="size-3" strokeWidth={1.75} />
          </TooltipTrigger>
          <TooltipPopup>{label}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
