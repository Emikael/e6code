import { Undo2Icon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export function ResetButton({
  onReset,
  disabled = false,
  label = "Reset to default",
  className,
}: {
  onReset: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="chip"
            className={cn("sb-action size-7 shrink-0", className)}
            aria-label={label}
            disabled={disabled}
            onClick={onReset}
          />
        }
      >
        <Undo2Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
