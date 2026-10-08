import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { QUIT_HOLD_DURATION_MS } from "@e6tools/contracts";

import { animate, canAnimate, EASE_IN_OUT, prefersReducedMotion } from "../lib/motion";
import { isMacPlatform } from "../lib/utils";
import { quitHoldFillMotion, scaleXFromTransform } from "./QuitHoldOverlay.logic";

/**
 * The desktop main process intercepts the quit accelerator and pushes
 * press/release states while it waits for a hold or second press.
 */
export function QuitHoldOverlay() {
  const [visibleMode, setVisibleMode] = useState<"hold" | "double-click" | null>(null);
  const [holding, setHolding] = useState(false);
  const fillRef = useRef<HTMLSpanElement>(null);
  // Captured in the shortcut handler, before React reapplies the resting
  // `scaleX(0)` style on the next commit.
  const scaleRef = useRef(0);

  useEffect(() => {
    const subscribe = window.desktopBridge?.onQuitShortcut;
    if (!subscribe) return;
    let hideTimer: number | undefined;
    let pressedMode: "hold" | "double-click" = "hold";
    const unsubscribe = subscribe((hint) => {
      window.clearTimeout(hideTimer);
      if (hint.state === "down") {
        pressedMode = hint.mode;
        scaleRef.current = 0;
        setVisibleMode(hint.mode);
        setHolding(hint.mode === "hold");
        return;
      }
      const fill = fillRef.current;
      scaleRef.current = fill ? scaleXFromTransform(getComputedStyle(fill).transform) : 0;
      setHolding(false);
      if (pressedMode === "double-click") {
        setVisibleMode(null);
        return;
      }
      hideTimer = window.setTimeout(() => setVisibleMode(null), QUIT_HOLD_DURATION_MS);
    });
    return () => {
      window.clearTimeout(hideTimer);
      unsubscribe();
    };
  }, []);

  // The fill is the hold's real progress. The handle stays so a release can
  // drain from the current scale instead of letting the replacement commit
  // the in-flight animation.
  useLayoutEffect(() => {
    const fill = fillRef.current;
    if (!canAnimate(fill)) return;
    const motion = quitHoldFillMotion({
      holding,
      reducedMotion: prefersReducedMotion(),
      currentScale: scaleRef.current,
      holdDurationMs: QUIT_HOLD_DURATION_MS,
    });
    if (motion.kind === "freeze") {
      fill.style.transform = `scaleX(${motion.scale})`;
      return;
    }
    const animation = animate(fill, {
      transform: [`scaleX(${motion.from})`, `scaleX(${motion.to})`],
      duration: motion.duration,
      ease: motion.kind === "fill" ? "linear" : EASE_IN_OUT,
    });
    return () => {
      animation.revert();
    };
  }, [holding]);

  if (!visibleMode) return null;
  const shortcut = isMacPlatform(navigator.platform) ? "⌘Q" : "Ctrl+Q";
  const message =
    visibleMode === "hold"
      ? `Hold ${shortcut} or press twice to quit`
      : `Press ${shortcut} again to quit`;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[22%] z-100 flex justify-center"
    >
      <div className="relative overflow-hidden rounded-full bg-neutral-700/95 px-8 py-4 text-2xl font-bold text-white shadow-xl">
        {visibleMode === "hold" ? (
          <span
            ref={fillRef}
            aria-hidden
            className="absolute inset-0 origin-left bg-white/14"
            style={{ transform: "scaleX(0)" }}
          />
        ) : null}
        <span className="relative">{message}</span>
      </div>
    </div>
  );
}
