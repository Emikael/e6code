import { CircleAlertIcon, InfoIcon, RotateCwIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Lets a 20px icon button take a 24px hit area without growing the header it sits in. */
const HIT_AREA_CLASS_NAME = "after:absolute after:-inset-0.5";

export function DiffFileStatus({
  error,
  truncated,
  retry,
}: {
  error?: boolean | undefined;
  truncated?: boolean | undefined;
  retry: () => void;
}) {
  if (error) {
    // A load failure is said in a word and in the error role, not by a muted icon alone.
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-error-foreground text-xs">
        <CircleAlertIcon aria-hidden className="size-3" />
        Not loaded
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost-muted"
                className={HIT_AREA_CLASS_NAME}
                aria-label="Retry loading this file's diff"
                onClick={(event) => {
                  event.stopPropagation();
                  retry();
                }}
              />
            }
          >
            <RotateCwIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup>Retry loading this file's diff</TooltipPopup>
        </Tooltip>
      </span>
    );
  }
  if (!truncated) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            className={HIT_AREA_CLASS_NAME}
            aria-label="Partial diff preview"
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <InfoIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>
        This file is too large to show in full. Counts include all changes.
      </TooltipPopup>
    </Tooltip>
  );
}
