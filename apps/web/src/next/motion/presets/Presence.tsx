import * as m from "motion/react-m";
import { type ReactNode, useCallback, useRef, useState } from "react";

import { useInViewport } from "../choreography/viewport.ts";
import { useMotionPolicy } from "../policy.ts";
import { numberSlots } from "./numberSlots.ts";
import { initialPresenceSlots, presenceSlots, presentSlot } from "./presenceSlots.ts";
import {
  type LayoutPreset,
  layoutTransition,
  matchCutReducedForm,
  type PresenceForm,
  presenceForm,
} from "./presets.ts";

const cx = (...names: ReadonlyArray<string | undefined>) => names.filter(Boolean).join(" ");

/**
 * The present content and at most one leaving (`presenceSlots`). Switching keys during
 * render is React's derived-state pattern. A leaving slot shows the content its key arrived
 * with, which is why callers change the key whenever the content changes.
 */
function usePresenceSlots(swapKey: string, children: ReactNode) {
  const [slots, setSlots] = useState(() => initialPresenceSlots(swapKey, children));
  let current = slots;
  if (presentSlot(slots)?.key !== swapKey) {
    current = presenceSlots(slots, { type: "show", key: swapKey, content: children });
    setSlots(current);
  }
  const left = useCallback(
    (key: string) => setSlots((previous) => presenceSlots(previous, { type: "left", key })),
    [],
  );
  return [current, left] as const;
}

function Slot({
  form,
  swapKey,
  children,
}: {
  readonly form: PresenceForm;
  readonly swapKey: string;
  readonly children: ReactNode;
}) {
  const [slots, left] = usePresenceSlots(swapKey, children);
  // What is there on mount does not animate in. A leaving slot keeps its key, so a value that
  // comes back mid-exit retargets from where it is; a third value cuts the older leaver.
  return slots.map((slot) => (
    <m.span
      key={slot.key}
      initial={slot.enters ? form.initial : false}
      animate={slot.leaving ? form.exit : form.animate}
      {...(slot.leaving ? { "aria-hidden": true, onAnimationComplete: () => left(slot.key) } : {})}
    >
      {slot.leaving ? slot.content : children}
    </m.span>
  ));
}

/**
 * `swap` (a status word changing in place) or `iconSwap` (Copy → check). Change `swapKey`
 * with the content. Below the level a preset plays at, the content changes as a cut.
 */
export function PresenceSwap({
  preset,
  swapKey,
  className,
  children,
}: {
  readonly preset: "swap" | "iconSwap";
  readonly swapKey: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const form = presenceForm(preset, useMotionPolicy());
  if (form === null) return <span className={className}>{children}</span>;
  return (
    <span className={cx("motion-swap-stack", className)}>
      <Slot form={form} swapKey={swapKey}>
        {children}
      </Slot>
    </span>
  );
}

/** `numberChange`: a formatted number in tabular figures whose changed digits roll. */
export function NumberRoll({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}) {
  const form = presenceForm("numberChange", useMotionPolicy());
  if (form === null) return <span className={cx("motion-number", className)}>{value}</span>;
  return (
    <span className={cx("motion-number", className)}>
      {numberSlots(value).map(({ slot, char }) => (
        <span key={slot} className="motion-swap-stack">
          <Slot form={form} swapKey={char}>
            {char}
          </Slot>
        </span>
      ))}
    </span>
  );
}

/**
 * `layout` (an element that moved animates to its new place, on screen only) or `matchCut`
 * (a shared element across two places, given `layoutId`). Needs a `LayoutScope` above it.
 * Below Full a move is a cut; `matchCut` cross-fades the region at Reduced.
 */
export function LayoutBox({
  preset,
  layoutId,
  inViewport,
  className,
  children,
}: {
  readonly preset: LayoutPreset;
  readonly layoutId?: string;
  /** From a virtualised list, which knows better than the observer. */
  readonly inViewport?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const level = useMotionPolicy();
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useInViewport(ref, inViewport);
  const transition = layoutTransition(preset, level);

  if (transition === null || !onScreen) {
    const crossFade = preset === "matchCut" && level === "reduced" ? matchCutReducedForm() : null;
    return (
      <m.div
        ref={ref}
        className={className}
        {...(crossFade ? { initial: crossFade.initial, animate: crossFade.animate } : {})}
      >
        {children}
      </m.div>
    );
  }
  return (
    <m.div
      ref={ref}
      className={className}
      layout
      {...(preset === "matchCut" && layoutId !== undefined ? { layoutId } : {})}
      transition={transition}
    >
      {children}
    </m.div>
  );
}
