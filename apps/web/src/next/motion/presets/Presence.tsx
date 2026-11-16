import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useRef } from "react";

import { useInViewport } from "../choreography/viewport.ts";
import { useMotionPolicy } from "../policy.ts";
import { numberSlots } from "./numberSlots.ts";
import {
  type LayoutPreset,
  layoutTransition,
  matchCutReducedForm,
  type PresenceForm,
  presenceForm,
} from "./presets.ts";

const cx = (...names: ReadonlyArray<string | undefined>) => names.filter(Boolean).join(" ");

function Slot({
  form,
  swapKey,
  children,
}: {
  readonly form: PresenceForm;
  readonly swapKey: string;
  readonly children: ReactNode;
}) {
  // `initial={false}`: what is there on mount does not animate. Rapid changes retarget: the
  // newest key is the one present, and leaving children run only their exit.
  return (
    <AnimatePresence initial={false}>
      <m.span key={swapKey} initial={form.initial} animate={form.animate} exit={form.exit}>
        {children}
      </m.span>
    </AnimatePresence>
  );
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
