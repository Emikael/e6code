import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import {
  MOTION_PREFERENCE_OPTIONS,
  type MotionPreference,
} from "@e6tools/client-runtime/motion-level";
import { DEFAULT_MOTION_PREFERENCE } from "@e6tools/contracts/settings";
import { ActivityIcon, PauseIcon, SquareIcon } from "lucide-react";
import { useId, useRef } from "react";

import { useMotionPolicyState } from "~/next/motion/policy";

import { handleMotionHomeEnd, motionResolutionLine } from "./MotionSettingRow.logic";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const LEVEL_ICONS = { full: ActivityIcon, reduced: PauseIcon, off: SquareIcon } as const;

/**
 * The Motion setting for redesigned screens (E02-T06). Rendered only while a redesigned
 * screen is enabled; classic screens keep Panel animations and the OS setting. The selected
 * value, the explanation and its icon all come from one MotionPolicy snapshot.
 */
export function MotionSettingRow({ onChange }: { onChange: (motion: MotionPreference) => void }) {
  const descriptionId = useId();
  const resolutionId = useId();
  const state = useMotionPolicyState();
  const resolution = motionResolutionLine(state);
  const radios = useRef(new Map<MotionPreference, HTMLElement>());
  const ResolutionIcon = resolution ? LEVEL_ICONS[resolution.level] : null;

  return (
    <SettingsRow
      {...searchableSetting("setting-motion")}
      description={
        <span id={descriptionId}>
          How much redesigned screens animate. Classic screens follow your system's reduced-motion
          setting.
        </span>
      }
      status={
        resolution && ResolutionIcon ? (
          <span id={resolutionId} className="flex items-center gap-1.5 text-foreground">
            <ResolutionIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {resolution.text}
          </span>
        ) : null
      }
      resetAction={
        state.preference !== DEFAULT_MOTION_PREFERENCE ? (
          <SettingResetButton label="motion" onClick={() => onChange(DEFAULT_MOTION_PREFERENCE)} />
        ) : null
      }
      control={
        <RadioGroupPrimitive
          aria-label="Motion"
          aria-describedby={resolution ? `${descriptionId} ${resolutionId}` : descriptionId}
          value={state.preference}
          onValueChange={(next) => {
            const option = MOTION_PREFERENCE_OPTIONS.find((candidate) => candidate.value === next);
            if (option) onChange(option.value);
          }}
          onKeyDown={(event) => {
            const handled = handleMotionHomeEnd(event.key, state.preference, {
              focus: (target) => radios.current.get(target)?.focus(),
              select: onChange,
            });
            if (handled) event.preventDefault();
          }}
          className="flex w-full gap-0.5 rounded-[9px] bg-surface-well p-[3px] @min-[32rem]/settings-row:w-auto"
        >
          {MOTION_PREFERENCE_OPTIONS.map((option) => (
            // No transition: the selected plate swaps at once and nothing moves on hover.
            <RadioPrimitive.Root
              key={option.value}
              value={option.value}
              ref={(element: HTMLElement | null) => {
                if (element) radios.current.set(option.value, element);
                else radios.current.delete(option.value);
              }}
              className="h-7 flex-1 cursor-pointer whitespace-nowrap rounded-md px-3 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-surface-raised data-checked:text-foreground data-checked:shadow-xs/10 data-checked:ring-1 data-checked:ring-border data-disabled:cursor-not-allowed data-disabled:opacity-50 @min-[32rem]/settings-row:flex-none"
            >
              {option.label}
            </RadioPrimitive.Root>
          ))}
        </RadioGroupPrimitive>
      }
    />
  );
}
