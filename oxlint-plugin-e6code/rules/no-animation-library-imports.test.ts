import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE = "e6code/no-animation-library-imports";
const rule = createOxlintRuleHarness(RULE);
const motionLayer = createOxlintRuleHarness(RULE, { ruleOptions: [{ allow: ["motion"] }] });
const legacyMotion = createOxlintRuleHarness(RULE, { ruleOptions: [{ allow: ["animejs"] }] });

describe(RULE, () => {
  rule.valid(
    "allows unrelated packages whose names start like an engine",
    `
      import { a } from "motion-sensor";
      import { b } from "@e6tools/design-tokens/motion";
      import { c } from "./motion";
      import { d } from "~/lib/motion";
      export { a, b, c, d };
    `,
  );

  rule.invalid(
    "reports a static import from a motion subpath",
    `
      import { AnimatePresence } from "motion/react";
      export { AnimatePresence };
    `,
    (output) => {
      assert.match(output, /motion/);
      assert.match(output, /next\/motion/);
    },
  );

  rule.invalid(
    "reports a dynamic gsap import",
    `
      export const load = () => import("gsap");
    `,
  );

  rule.invalid(
    "reports a dynamic import written as a template literal",
    "export const load = () => import(`gsap`);",
    (output) => assert.match(output, /import gsap here/),
  );

  rule.valid(
    "ignores a template literal it cannot resolve",
    "const name = 'x'; export const load = () => import(`./${name}`);",
  );

  rule.invalid(
    "reports gsap plugins and Anime.js subpaths",
    `
      import { ScrollTrigger } from "gsap/ScrollTrigger";
      import { waapi } from "animejs/waapi";
      export { ScrollTrigger, waapi };
    `,
    (output) => {
      assert.match(output, /import gsap here/);
      assert.match(output, /import animejs here/);
    },
  );

  rule.invalid(
    "reports re-exports",
    `
      export * from "motion";
      export { animate } from "framer-motion";
    `,
    (output) => {
      assert.match(output, /import motion here/);
      assert.match(output, /import framer-motion here/);
    },
  );

  rule.invalid(
    "reports require of animejs",
    `
      const anime = require("animejs");
      export default anime;
    `,
  );

  rule.invalid(
    "reports type-only imports and the engine internals",
    `
      import type { Transition } from "motion-dom";
      import { clamp } from "motion-utils";
      import { useGSAP } from "@gsap/react";
      export type T = Transition;
      export { clamp, useGSAP };
    `,
    (output) => {
      assert.match(output, /import motion-dom here/);
      assert.match(output, /import motion-utils here/);
      assert.match(output, /import @gsap\/react here/);
    },
  );

  motionLayer.valid(
    "lets the motion layer import motion",
    `
      import { MotionConfig } from "motion/react";
      export const load = () => import("motion/react-m");
      export { MotionConfig };
    `,
  );

  motionLayer.invalid(
    "keeps framer-motion out of the motion layer",
    `
      import { LazyMotion } from "framer-motion";
      export { LazyMotion };
    `,
  );

  motionLayer.invalid(
    "keeps gsap out of the motion layer outside the cinematic runner",
    `
      export const load = () => import("gsap");
    `,
  );

  legacyMotion.valid(
    "lets the legacy engine module keep Anime.js",
    `
      import { waapi } from "animejs/waapi";
      import type { DOMTargetsParam } from "animejs";
      export type T = DOMTargetsParam;
      export { waapi };
    `,
  );

  legacyMotion.invalid(
    "does not extend the legacy grant to gsap plugins",
    `
      import { ScrollTrigger } from "gsap/ScrollTrigger";
      export { ScrollTrigger };
    `,
  );

  legacyMotion.invalid(
    "does not extend the legacy grant to motion",
    `
      import { animate } from "motion";
      export { animate };
    `,
  );
});
