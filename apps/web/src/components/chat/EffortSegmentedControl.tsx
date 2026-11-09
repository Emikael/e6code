import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import {
  EFFORT_SEGMENTS,
  EFFORT_SEGMENT_LABELS,
  type EffortSegment,
  effortSegmentName,
} from "@e6tools/client-runtime/effort-segments";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerControlSize } from "./ComposerControl";
import type { EffortSegmentControl } from "./TraitsPicker";

/**
 * Three-step effort as a radio group. Arrow keys move and select, like any radio group. The
 * selected step is raised, outlined and bold, so it never reads by colour alone. Each step names
 * itself as effort and gives the model's real level, so "Fast" never reads as fast mode.
 */
export function EffortSegmentedControl(props: {
  control: EffortSegmentControl;
  size?: ComposerControlSize;
  className?: string;
}) {
  const { control } = props;
  return (
    <RadioGroupPrimitive<EffortSegment | "">
      aria-label={control.currentLabel ? `Effort: ${control.currentLabel}` : "Effort"}
      value={control.selected ?? ""}
      disabled={control.disabled}
      onValueChange={(value) => {
        if (value) control.select(value);
      }}
      data-effort-segmented-control=""
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-[var(--control-radius)] bg-muted/60 p-0.5",
        props.className,
      )}
    >
      {EFFORT_SEGMENTS.map((segment) => {
        const name = effortSegmentName(control.segments, segment);
        return (
          <Tooltip key={segment}>
            <TooltipTrigger
              render={
                <RadioPrimitive.Root
                  value={segment}
                  nativeButton
                  render={<button type="button" />}
                  aria-label={name}
                  className={cn(
                    "cursor-pointer rounded-[calc(var(--control-radius)-2px)] px-2 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:cursor-default data-disabled:opacity-64",
                    props.size === "xs" ? "h-5" : "h-6",
                    "data-checked:bg-background data-checked:font-medium data-checked:text-foreground data-checked:shadow-xs data-checked:ring-1 data-checked:ring-primary-edge data-checked:ring-inset",
                  )}
                />
              }
            >
              {EFFORT_SEGMENT_LABELS[segment]}
            </TooltipTrigger>
            <TooltipPopup side="top">{name}</TooltipPopup>
          </Tooltip>
        );
      })}
    </RadioGroupPrimitive>
  );
}
