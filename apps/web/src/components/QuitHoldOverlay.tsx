import { useEffect, useRef, useState } from "react";

import { animate, canAnimate, EASE_IN_OUT } from "../lib/motion";
import { isMacPlatform } from "../lib/utils";

// A released hold hint lingers for the original hold duration. Double-press
// hints disappear as soon as their acceptance window closes.
const HOLD_HINT_LINGER_MS = 1200;

/**
 * The desktop main process intercepts the quit accelerator and pushes
 * press/release states while it waits for a hold or second press.
 */
export function QuitHoldOverlay() {
  const [visibleMode, setVisibleMode] = useState<"hold" | "double-click" | null>(null);
  const [holding, setHolding] = useState(false);
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const subscribe = window.desktopBridge?.onQuitShortcut;
    if (!subscribe) return;
    let hideTimer: number | undefined;
    let pressedMode: "hold" | "double-click" = "hold";
    const unsubscribe = subscribe((hint) => {
      window.clearTimeout(hideTimer);
      if (hint.state === "down") {
        pressedMode = hint.mode;
        setVisibleMode(hint.mode);
        setHolding(hint.mode === "hold");
        return;
      }
      setHolding(false);
      if (pressedMode === "double-click") {
        setVisibleMode(null);
        return;
      }
      hideTimer = window.setTimeout(() => setVisibleMode(null), HOLD_HINT_LINGER_MS);
    });
    return () => {
      window.clearTimeout(hideTimer);
      unsubscribe();
    };
  }, []);

  // The fill is the hold's real progress: it runs for the main process's hold
  // duration and drains back when the shortcut is released early.
  useEffect(() => {
    const fill = fillRef.current;
    if (!canAnimate(fill)) return;
    if (holding) {
      animate(fill, {
        transform: ["scaleX(0)", "scaleX(1)"],
        duration: HOLD_HINT_LINGER_MS,
        ease: "linear",
      });
    } else {
      animate(fill, { transform: "scaleX(0)", duration: 200, ease: EASE_IN_OUT });
    }
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
