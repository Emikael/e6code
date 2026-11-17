/**
 * Motion tokens only the v2 CSS presets read: travel, springs as `linear()` curves, and the
 * skeleton breath. They render into `apps/web/src/next/motion/presets/presets.css` through its
 * `motion-presets` placeholder, so they load with `MotionRoot` and never reach the stylesheet
 * every screen pays for. The shared scale (`--dur-*`, `--ease-*`) stays in the key-light block.
 */
import { DISTANCE, SKELETON, SPRING_CURVE } from "./motion.ts";
import type { CssRule } from "./webStock.ts";

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** Travel in px, scale factors unitless (see `DISTANCE`). */
const distances = Object.entries(DISTANCE).map(
  ([name, value]) =>
    [`--distance-${kebab(name)}`, /scale/i.test(name) ? `${value}` : `${value}px`] as const,
);
// Not `--ease-spring-*`: legacy `installMotionTokens` writes those inline on `:root`.
const springs = Object.entries(SPRING_CURVE).flatMap(([name, { linear, durationMs }]) => [
  [`--spring-${name}`, linear] as const,
  [`--spring-${name}-dur`, `${durationMs}ms`] as const,
]);

export const MOTION_PRESET_TOKENS: CssRule = {
  rule: ":root",
  body: [
    ...distances,
    ...springs,
    ["--skeleton-dur", `${SKELETON.durationMs}ms`],
    ["--skeleton-steps", `${SKELETON.steps}`],
    ["--skeleton-floor", `${SKELETON.floorOpacity}`],
  ],
};

export const MOTION_PRESET_BLOCKS = { "motion-presets": MOTION_PRESET_TOKENS } as const;
