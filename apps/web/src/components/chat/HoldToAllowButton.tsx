import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import { cn, isMacPlatform } from "~/lib/utils";
import { createHoldToConfirm, HOLD_TO_CONFIRM_MS } from "./holdToConfirm";

interface HoldToAllowButtonProps {
  /** What the command would do, e.g. "Deletes files recursively". */
  reason: string;
  disabled: boolean;
  /** Listen for a held ⌘↵ / Ctrl+↵ anywhere while this approval is showing. */
  shortcutEnabled: boolean;
  onConfirm: () => void;
}

/**
 * Approve for destructive commands: a click does nothing, the button must be
 * held for a second by pointer, Enter/Space, or ⌘↵. The fill is a single CSS
 * transition that only runs while held; reduced-motion users get the same
 * hold with a text cue instead of the fill.
 */
export function HoldToAllowButton({
  reason,
  disabled,
  shortcutEnabled,
  onConfirm,
}: HoldToAllowButtonProps) {
  const [holding, setHolding] = useState(false);
  const descriptionId = useId();
  const [hold] = useState(() => createHoldToConfirm({ onHoldingChange: setHolding }));
  // The window listener outlives renders; re-subscribing on every new callback
  // would release a ⌘↵ hold whenever the parent re-renders mid-hold.
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  });

  useEffect(() => {
    if (disabled) hold.cancel();
  }, [disabled, hold]);
  useEffect(() => () => hold.cancel(), [hold]);

  useEffect(() => {
    if (!shortcutEnabled || disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey || event.isComposing) return;
      // Claimed before the composer sees it: a held ⌘↵ must never send.
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) hold.press("shortcut", () => onConfirmRef.current());
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Meta" || event.key === "Control") {
        hold.release("shortcut");
      }
    };
    const onBlur = () => hold.cancel();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      hold.release("shortcut");
    };
  }, [disabled, hold, shortcutEnabled]);

  const shortcut = isMacPlatform(navigator.platform) ? "⌘↵" : "Ctrl+↵";
  return (
    <>
      <Button
        size="xs"
        variant="destructive-outline"
        disabled={disabled}
        aria-describedby={descriptionId}
        className="relative overflow-hidden select-none"
        data-holding={holding ? "true" : undefined}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          hold.press("pointer", onConfirm);
        }}
        onPointerUp={() => hold.release("pointer")}
        onPointerCancel={() => hold.release("pointer")}
        onLostPointerCapture={() => hold.release("pointer")}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Never let a keypress activate the button as a click.
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) hold.press("key", onConfirm);
        }}
        onKeyUp={(event) => {
          if (event.key === "Enter" || event.key === " ") hold.release("key");
        }}
        onBlur={() => hold.cancel()}
        onClick={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-full origin-left bg-destructive/16 motion-reduce:hidden",
            holding ? "scale-x-100 transition-transform ease-linear" : "scale-x-0",
          )}
          style={holding ? { transitionDuration: `${HOLD_TO_CONFIRM_MS}ms` } : undefined}
        />
        <span className="relative">{holding ? "Keep holding…" : "Hold to allow"}</span>
      </Button>
      <span id={descriptionId} className="sr-only">
        {`${reason}. Press and hold for one second to allow, or hold ${shortcut}.`}
      </span>
      <span className="sr-only" aria-live="polite">
        {holding ? "Keep holding to allow" : ""}
      </span>
    </>
  );
}
