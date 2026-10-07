import {
  EASE_OUT,
  MOTION_MS,
  playTransient,
  prefersReducedMotion,
  staggerDelay,
  type TransientMotion,
} from "~/lib/motion";

const ITEM_SELECTOR = "[data-slot=command-item]";
const ENTRANCE_ITEMS = 8;
// Past this the eye has lost the old row; a glide would read as lag.
const MAX_GLIDE_PX = 180;

/**
 * Callback ref for command lists. Rows rise in on open, and the highlight
 * glides between rows: a ghost carries the highlight from the old row to the
 * new one while the list's own highlight background is muted.
 */
export function observeCommandListMotion(list: HTMLElement | null) {
  if (!list || typeof MutationObserver === "undefined") return;
  if (prefersReducedMotion()) return;

  const entering = list.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
  const entrance =
    entering.length > 0
      ? playTransient(Array.from(entering).slice(0, ENTRANCE_ITEMS), {
          opacity: [0, 1],
          transform: ["translateY(4px)", "none"],
          duration: MOTION_MS.state,
          delay: staggerDelay(18),
          ease: EASE_OUT,
        })
      : null;

  let highlighted = list.querySelector<HTMLElement>(`${ITEM_SELECTOR}[data-highlighted]`);
  let ghost: HTMLElement | null = null;
  let glide: TransientMotion | null = null;

  const endGlide = () => {
    glide?.cancel();
    glide = null;
    ghost?.remove();
    ghost = null;
    delete list.dataset.highlightGliding;
  };

  const observer = new MutationObserver(() => {
    const next = list.querySelector<HTMLElement>(`${ITEM_SELECTOR}[data-highlighted]`);
    if (next === highlighted) return;
    const from = ghost ?? highlighted;
    highlighted = next;
    if (!next || !from?.isConnected) {
      endGlide();
      return;
    }
    const listRect = list.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const toRect = next.getBoundingClientRect();
    const travel = fromRect.top - toRect.top;
    endGlide();
    if (travel === 0 || Math.abs(travel) > MAX_GLIDE_PX) return;

    // Read the highlight's paint before muting it, so every list variant keeps its own look.
    const { backgroundColor, borderRadius } = getComputedStyle(next);
    ghost = document.createElement("span");
    ghost.setAttribute("aria-hidden", "true");
    ghost.className = "pointer-events-none absolute -z-1";
    Object.assign(ghost.style, {
      backgroundColor,
      borderRadius,
      top: `${toRect.top - listRect.top + list.scrollTop - list.clientTop}px`,
      left: `${toRect.left - listRect.left + list.scrollLeft - list.clientLeft}px`,
      width: `${toRect.width}px`,
      height: `${toRect.height}px`,
    });
    list.append(ghost);
    list.dataset.highlightGliding = "";
    glide = playTransient(ghost, {
      transform: [`translateY(${travel}px)`, "none"],
      duration: 140,
      ease: EASE_OUT,
    });
    const current = glide;
    void current.finished.then(() => {
      if (glide === current) endGlide();
    });
  });
  observer.observe(list, {
    attributes: true,
    attributeFilter: ["data-highlighted"],
    subtree: true,
  });

  return () => {
    observer.disconnect();
    entrance?.cancel();
    endGlide();
  };
}
