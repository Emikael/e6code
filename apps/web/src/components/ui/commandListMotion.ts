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
const OVERLAY_SELECTOR = "[data-command-highlight-overlay]";
// Past this the eye has lost the old row; a glide would read as lag.
const MAX_GLIDE_PX = 180;

/** Box of the highlight ghost inside an overlay that covers the visible list, not the scrolled content. */
export function highlightGhostFrame(
  origin: { readonly top: number; readonly left: number },
  target: {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
  },
) {
  return {
    top: target.top - origin.top,
    left: target.left - origin.left,
    width: target.width,
    height: target.height,
  };
}

function highlightHost(list: HTMLElement): HTMLElement | null {
  const viewport = list.closest("[data-slot=scroll-area-viewport]");
  const host = viewport?.parentElement;
  return host instanceof HTMLElement ? host : null;
}

function highlightOverlay(list: HTMLElement): HTMLElement | null {
  const host = highlightHost(list);
  if (!host) return null;
  // The scroll root is the visible frame. The viewport inside it scrolls, so a
  // ghost parented there would travel with the rows. `isolation` keeps the
  // negative z-index above the frame background.
  host.style.isolation = "isolate";
  const existing = host.querySelector(`:scope > ${OVERLAY_SELECTOR}`);
  if (existing instanceof HTMLElement) return existing;
  const overlay = document.createElement("div");
  overlay.dataset.commandHighlightOverlay = "";
  overlay.setAttribute("aria-hidden", "true");
  overlay.className = "pointer-events-none absolute inset-0 -z-1 overflow-hidden";
  host.append(overlay);
  return overlay;
}

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
    const fromRect = from.getBoundingClientRect();
    const toRect = next.getBoundingClientRect();
    const travel = fromRect.top - toRect.top;
    endGlide();
    if (travel === 0 || Math.abs(travel) > MAX_GLIDE_PX) return;
    const overlay = highlightOverlay(list);
    if (!overlay) return;

    // Read the highlight's paint before muting it, so every list variant keeps its own look.
    const { backgroundColor, borderRadius } = getComputedStyle(next);
    const frame = highlightGhostFrame(overlay.getBoundingClientRect(), toRect);
    ghost = document.createElement("span");
    ghost.setAttribute("aria-hidden", "true");
    ghost.className = "pointer-events-none absolute";
    Object.assign(ghost.style, {
      backgroundColor,
      borderRadius,
      top: `${frame.top}px`,
      left: `${frame.left}px`,
      width: `${frame.width}px`,
      height: `${frame.height}px`,
    });
    overlay.append(ghost);
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
    highlightHost(list)?.querySelector(`:scope > ${OVERLAY_SELECTOR}`)?.remove();
  };
}
