import type { MotionPolicyStore } from "./policy.ts";

/**
 * Mirrors the policy level onto `data-motion` of `root` (the `<html>` element), which the CSS
 * presets read; Tailwind's `motion-reduce:` sees only the OS setting. Returns the way to stop
 * and remove the attribute, after which the CSS falls back to the OS setting.
 */
export const syncMotionAttribute = (
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  policy: Pick<MotionPolicyStore, "getLevel" | "subscribe">,
): (() => void) => {
  const write = () => root.setAttribute("data-motion", policy.getLevel());
  const unsubscribe = policy.subscribe(write);
  write();
  return () => {
    unsubscribe();
    root.removeAttribute("data-motion");
  };
};
