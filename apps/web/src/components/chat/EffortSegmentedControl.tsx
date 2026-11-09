import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { EFFORT_SEGMENTS, type EffortSegment } from "@e6tools/client-runtime/effort-segments";

import { cn } from "~/lib/utils";
import type { ComposerControlSize } from "./ComposerControl";
import type { EffortSegmentControl } from "./TraitsPicker";

// The composer names intent; the model picker names the level, as in the design.
const SEGMENT_LABELS = {
  composer: { fast: "Fast", balanced: "Balanced", deep: "Deep" },
  picker: { fast: "Low", balanced: "Medium", deep: "High" },
} as const satisfies Record<string, Record<EffortSegment, string>>;

/**
 * Three-step effort as a radio group. Arrow keys move and select, like any radio group. The
 * selected step is raised, outlined and bold, so it never reads by colour alone.
 */
export function EffortSegmentedControl(props: {
  control: EffortSegmentControl;
  labels: keyof typeof SEGMENT_LABELS;
  size?: ComposerControlSize;
  className?: string;
}) {
  const { control } = props;
  const labels = SEGMENT_LABELS[props.labels];
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
      {EFFORT_SEGMENTS.map((segment) => (
        <RadioPrimitive.Root
          key={segment}
          value={segment}
          nativeButton
          render={<button type="button" />}
          className={cn(
            "cursor-pointer rounded-[calc(var(--control-radius)-2px)] px-2 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:cursor-default data-disabled:opacity-64",
            props.size === "xs" ? "h-5" : "h-6",
            "data-checked:bg-background data-checked:font-medium data-checked:text-foreground data-checked:shadow-xs data-checked:ring-1 data-checked:ring-border data-checked:ring-inset",
          )}
        >
          {labels[segment]}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  );
}
