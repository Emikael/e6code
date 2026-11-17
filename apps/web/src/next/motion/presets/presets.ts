import type { MotionLevel } from "@e6tools/client-runtime/motion-level";

import { DISTANCE, DUR_S, EASE_BEZIER, SPRING } from "../tokens.ts";

/**
 * The presets `motion` drives (presence, layout). The CSS presets live in `presets.css`; the
 * one-shots in `oneShot.ts`. Values come from the tokens only.
 *
 * A form is what one MotionPolicy level plays. `null` means the change is a cut: the end
 * state renders at once and no Animation object is created. Every level still shows the
 * change, because the content itself (a word, an icon, a digit) changes.
 */

/** What a preset may animate: transform, through `motion`'s aliases, and opacity. */
// Type aliases, not interfaces, so they stay assignable to `motion`'s indexed target type.
export type PresetValues = {
  readonly opacity?: number;
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
};

export type PresetTransition = {
  /** Seconds. */
  readonly duration: number;
  readonly ease: readonly [number, number, number, number];
};

export type PresenceForm = {
  /** Where an entering element starts. */
  readonly initial: PresetValues;
  /** Rest, with the entrance timing. */
  readonly animate: PresetValues & { readonly transition: PresetTransition };
  /** Where a leaving element goes, with the exit timing. */
  readonly exit: PresetValues & { readonly transition: PresetTransition };
};

export type PresencePreset = "swap" | "iconSwap" | "numberChange";

const enter = (duration: number): PresetTransition => ({ duration, ease: EASE_BEZIER.enter });
const leave = (duration: number): PresetTransition => ({ duration, ease: EASE_BEZIER.exit });

/** Reduced presence: a cross-fade with no travel, `DUR.quick`. */
const crossFade = (): PresenceForm => ({
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: enter(DUR_S.quick) },
  exit: { opacity: 0, transition: leave(DUR_S.quick) },
});

/*
 * The leaving half of `swap` and `iconSwap` overlaps the entrance; the design's 80 ms rounds
 * to `DUR.micro`.
 */
type PresenceTable = Record<PresencePreset, Record<MotionLevel, PresenceForm | null>>;

// Built on first use, so importing the barrel computes nothing.
const buildPresence = (): PresenceTable => ({
  // A row status changing in place: Running → Done.
  swap: {
    full: {
      initial: { opacity: 0, y: DISTANCE.revealMin },
      animate: { opacity: 1, y: 0, transition: enter(DUR_S.brisk) },
      exit: { opacity: 0, y: -DISTANCE.revealMin, transition: leave(DUR_S.micro) },
    },
    reduced: crossFade(),
    off: null,
  },
  // Copy → check. Scales to 0.6, the exception for icons of 20 px or less (ENG-119).
  iconSwap: {
    full: {
      initial: { opacity: 0, scale: DISTANCE.iconScaleFrom },
      animate: { opacity: 1, scale: 1, transition: enter(DUR_S.brisk) },
      exit: { opacity: 0, scale: DISTANCE.iconScaleFrom, transition: leave(DUR_S.micro) },
    },
    // The word beside the icon ("Copied") carries the change.
    reduced: null,
    off: null,
  },
  // One changed digit: the old one rolls up and out, the new one in from below.
  numberChange: {
    full: {
      initial: { opacity: 0, y: DISTANCE.revealMin },
      animate: { opacity: 1, y: 0, transition: enter(DUR_S.state) },
      exit: { opacity: 0, y: -DISTANCE.revealMin, transition: leave(DUR_S.quick) },
    },
    reduced: null,
    off: null,
  },
});

let presence: PresenceTable | undefined;
const presenceTable = () => (presence ??= buildPresence());

export const presenceForm = (preset: PresencePreset, level: MotionLevel) =>
  presenceTable()[preset][level];

/** Every presence form, for the property test. */
export const presenceForms = () =>
  Object.entries(presenceTable()).flatMap(([preset, levels]) =>
    Object.entries(levels).map(([level, form]) => ({
      preset: preset as PresencePreset,
      level: level as MotionLevel,
      form,
    })),
  );

export type LayoutPreset = "layout" | "matchCut";

export type LayoutTransition =
  | { readonly type: "spring"; readonly visualDuration: number; readonly bounce: number }
  | PresetTransition;

/**
 * `layout`: a row that moved (new activity to the top) travels on `spring.gentle`.
 * `matchCut`: a shared element (row title → header) on `dur.scene` and `ease.expo`.
 * Both are cuts below Full; `matchCut`'s Reduced form cross-fades the region instead
 * (`LayoutBox` does that with `crossFade`).
 */
export const layoutTransition = (
  preset: LayoutPreset,
  level: MotionLevel,
): LayoutTransition | null => {
  if (level !== "full") return null;
  return preset === "layout"
    ? {
        type: "spring",
        visualDuration: SPRING.gentle.duration / 1000,
        bounce: SPRING.gentle.bounce,
      }
    : { duration: DUR_S.scene, ease: EASE_BEZIER.expo };
};

/** The region cross-fade `matchCut` plays at Reduced. */
export const matchCutReducedForm = () => crossFade();
