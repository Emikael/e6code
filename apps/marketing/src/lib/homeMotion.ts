/**
 * Sets `--home-motion-state` to `running` on each element only while it is on
 * screen, the tab is visible, and reduced motion is off. CSS animations read it
 * through `animation-play-state`, so off-screen loops never repaint.
 */
export function startHomeMotion(elements: HTMLElement[]) {
  if (typeof IntersectionObserver === "undefined") return () => {};

  const visible = new Set<Element>();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const events = new AbortController();
  let disposed = false;

  const canMove = (element: Element) =>
    !disposed &&
    visible.has(element) &&
    document.visibilityState === "visible" &&
    !reducedMotion.matches;

  function update() {
    for (const element of elements) {
      element.style.setProperty("--home-motion-state", canMove(element) ? "running" : "paused");
    }
  }

  const observer = new IntersectionObserver((entries) => {
    if (disposed) return;
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    update();
  });
  for (const element of elements) observer.observe(element);

  document.addEventListener("visibilitychange", update, { signal: events.signal });
  reducedMotion.addEventListener("change", update, { signal: events.signal });
  update();

  return () => {
    if (disposed) return;
    disposed = true;
    events.abort();
    observer.disconnect();
    update();
  };
}
