import { prefersReducedMotion, subscribeReducedMotion } from "./motion";

interface ObservedAnimation {
  element: HTMLElement | SVGElement;
  intersecting: boolean;
}

const animations = new Map<Element, ObservedAnimation>();
let observer: IntersectionObserver | null = null;
let unsubscribeReducedMotion: (() => void) | null = null;

function updateAnimation(animation: ObservedAnimation) {
  const running =
    animation.intersecting && document.visibilityState === "visible" && !prefersReducedMotion();
  animation.element.style.setProperty("--visible-animation-state", running ? "running" : "paused");
  animation.element.style.setProperty(
    "--visible-animation-will-change",
    running ? "transform" : "auto",
  );
}

function updateAnimations() {
  for (const animation of animations.values()) updateAnimation(animation);
}

/** Attach to a stable animation container. All refs share visibility and motion listeners. */
export function observeVisibleAnimation(element: HTMLElement | SVGElement | null) {
  if (element === null) return;
  element.style.setProperty("--visible-animation-state", "paused");
  element.style.setProperty("--visible-animation-will-change", "auto");
  if (typeof IntersectionObserver === "undefined") return;

  if (observer === null) {
    unsubscribeReducedMotion = subscribeReducedMotion(updateAnimations);
    document.addEventListener("visibilitychange", updateAnimations);
    observer = new IntersectionObserver((entries, source) => {
      if (source !== observer) return;
      for (const entry of entries) {
        const animation = animations.get(entry.target);
        if (!animation) continue;
        animation.intersecting = entry.isIntersecting;
        updateAnimation(animation);
      }
    });
  }

  const animation = { element, intersecting: false };
  animations.set(element, animation);
  observer.observe(element);

  return () => {
    if (animations.get(element) !== animation) return;
    animations.delete(element);
    observer?.unobserve(element);
    element.style.setProperty("--visible-animation-state", "paused");
    element.style.setProperty("--visible-animation-will-change", "auto");
    if (animations.size === 0) {
      observer?.disconnect();
      observer = null;
      unsubscribeReducedMotion?.();
      unsubscribeReducedMotion = null;
      document.removeEventListener("visibilitychange", updateAnimations);
    }
  };
}
