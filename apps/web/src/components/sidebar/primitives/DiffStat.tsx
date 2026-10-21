import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { normalizeCount } from "./metrics";

export function DiffStat({
  additions,
  deletions,
  decorative = false,
  className,
}: {
  additions?: number | null;
  deletions?: number | null;
  /** Hide from assistive tech when the surrounding row describes it instead. */
  decorative?: boolean;
  className?: string;
}) {
  const added = normalizeCount(additions);
  const deleted = normalizeCount(deletions);
  const summary = `Last turn: +${added ?? "?"} −${deleted ?? "?"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": summary })}
        className={cn(
          "inline-flex gap-1 font-mono text-(length:--sb-text-meta) tabular-nums",
          className,
        )}
      >
        <span className={added === null ? "text-sb-muted" : "text-sb-addition"}>
          +{added ?? "?"}
        </span>
        <span className={deleted === null ? "text-sb-muted" : "text-sb-deletion"}>
          −{deleted ?? "?"}
        </span>
      </TooltipTrigger>
      <TooltipPopup>{summary}</TooltipPopup>
    </Tooltip>
  );
}
