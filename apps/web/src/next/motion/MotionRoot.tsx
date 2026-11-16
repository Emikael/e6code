import { LazyMotion, MotionConfig } from "motion/react";
import { type ReactNode, useLayoutEffect } from "react";

import { motionConfigFor } from "./motionConfig.ts";
import { syncMotionAttribute } from "./motionAttribute.ts";
import { motionPolicy, useMotionPolicy } from "./policy.ts";
import "./presets/presets.css";

const loadDomAnimation = () =>
  import("./features/domAnimation.ts").then((module) => module.default);
const loadDomMax = () => import("./features/domMax.ts").then((module) => module.default);

/**
 * The root of every v2 surface (mounted by the v2 shell, E04-T14). It loads the CSS presets,
 * writes the policy level to `data-motion` on `<html>`, loads `motion`'s animation features
 * after first paint (until then `m` components render their end state, a cut), and sets
 * `MotionConfig` from the policy, never from the library's own reduced-motion default.
 */
export function MotionRoot({ children }: { readonly children: ReactNode }) {
  const level = useMotionPolicy();
  useLayoutEffect(() => syncMotionAttribute(document.documentElement, motionPolicy), []);
  return (
    <LazyMotion features={loadDomAnimation} strict>
      <MotionConfig {...motionConfigFor(level)}>{children}</MotionConfig>
    </LazyMotion>
  );
}

/**
 * Wraps a region that uses `layout` or `matchCut` (`LayoutBox`). The layout features load the
 * first time one mounts, so screens without them never pay for them.
 */
export function LayoutScope({ children }: { readonly children: ReactNode }) {
  return <LazyMotion features={loadDomMax}>{children}</LazyMotion>;
}
