import type { MotionLevel } from "@e6tools/client-runtime/motion-level";
import { animate } from "motion/mini";

import { type AnimateDriver, createRetargeter } from "../choreography/retarget.ts";
import { motionPolicy } from "../policy.ts";
import { DISTANCE, DUR_S } from "../tokens.ts";

const miniDriver: AnimateDriver<Element> = (target, keyframes, { duration, ease }) =>
  animate(target, keyframes, { duration, ease: ease === "linear" ? ease : [...ease] });

const travel = (px: number) => `translateX(${px}px)`;

/** Three swings either side of rest, then rest. `motion/mini` takes no `x` alias. */
const shakeFrames = () => [
  ...Array.from({ length: 3 }, () => [travel(-DISTANCE.shake), travel(DISTANCE.shake)]).flat(),
  travel(0),
];

/**
 * Creates the one-shot presets over a driver; the app uses `oneShots`, tests a fake driver.
 * Each returns whether it animated.
 */
export const createOneShots = <Target extends object>(
  driver: AnimateDriver<Target>,
  getLevel: () => MotionLevel,
) => {
  const retargeter = createRetargeter(driver);
  return {
    /**
     * `shake`: rejected user input only, never an agent error. Reduced and Off do nothing;
     * the error text and the invalid field carry the change. A second rejection mid-shake
     * restarts it from where the field is (the newer state wins).
     */
    shake(target: Target): boolean {
      if (getLevel() !== "full") return false;
      retargeter.run(
        target,
        { transform: shakeFrames() },
        { duration: DUR_S.move, ease: "linear" },
      );
      return true;
    },
    /** Data beats animation: ends a running one-shot at its end state. */
    finish: retargeter.finish,
  };
};

// Pure, so a module that reads only the policy from the barrel does not keep `motion/mini`.
export const oneShots = /* @__PURE__ */ createOneShots(miniDriver, () => motionPolicy.getLevel());
