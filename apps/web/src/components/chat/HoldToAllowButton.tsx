import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn, isMacPlatform } from "~/lib/utils";
import { composerFloatingLayerProps } from "./composerEventScope";
import {
  approvalShortcutAppliesTo,
  approvalShortcutClaimsKeyDown,
  approvalShortcutKeyUpReleases,
  createHoldToConfirm,
} from "./holdToConfirm";
import { HOLD_TO_CONFIRM_MS } from "@e6tools/client-runtime/destructive-commands";

interface HoldToAllowButtonProps {
  /** What the command would do, e.g. "Deletes files recursively". */
  reason: string;
  disabled: boolean;
  /** Listen for a held ⌘↵ / Ctrl+↵ from the composer or an approval card. */
  shortcutEnabled: boolean;
  /** Show "Hold ⌘↵" in the tooltip; defaults to `shortcutEnabled`. */
  showShortcutHint?: boolean;
  /** "xs" beside the composer; "default" on the start screen's approval card. */
  size?: "xs" | "default";
  onConfirm: () => void;
}

/**
 * Approve for destructive commands: a click does nothing, the button must be
 * held for a second by pointer, Enter/Space, or ⌘↵. The fill is a single CSS
 * transition that only runs while held; reduced-motion users get the same
 * hold with a text cue instead of the fill. Assistive tech that can only
 * click (Voice Control, switch access, a screen reader's activate) gets a
 * confirmation dialog naming the reason instead.
 */
export function HoldToAllowButton({
  reason,
  disabled,
  shortcutEnabled,
  showShortcutHint = shortcutEnabled,
  size = "xs",
  onConfirm,
}: HoldToAllowButtonProps) {
  const [holding, setHolding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      if (!approvalShortcutClaimsKeyDown(event, document.activeElement)) {
        // Anything else pressed mid-hold, or ⌘↵ claimed elsewhere, ends it.
        if (event.key !== "Meta" && event.key !== "Control") hold.release("shortcut");
        return;
      }
      // Claimed before the composer or the merge shortcut sees it: a held ⌘↵
      // must never send, and must never also open another dialog.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) {
        hold.repeat("shortcut");
        return;
      }
      // A fresh keydown means Enter was let go, even if macOS never said so.
      hold.release("shortcut");
      hold.press("shortcut", () => onConfirmRef.current());
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (approvalShortcutKeyUpReleases(event)) hold.release("shortcut");
    };
    // A dialog opening, or focus moving anywhere outside the composer and
    // approval cards, ends a ⌘↵ hold.
    const onFocusIn = () => {
      if (!approvalShortcutAppliesTo(document.activeElement)) hold.release("shortcut");
    };
    const onBlur = () => hold.cancel();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("blur", onBlur);
      hold.release("shortcut");
    };
  }, [disabled, hold, shortcutEnabled]);

  const shortcut = isMacPlatform(navigator.platform) ? "⌘↵" : "Ctrl+↵";
  const button = (
    <Button
      size={size}
      variant="destructive-outline"
      disabled={disabled}
      aria-describedby={descriptionId}
      className="relative overflow-hidden select-none"
      data-holding={holding ? "true" : undefined}
      // Read by destructiveApprovalPendingIn: the merge shortcut stands down.
      data-destructive-approval-hold=""
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
        if (event.key !== "Enter" && event.key !== " ") return;
        // Space activates on keyup in some browsers; that must not click either.
        event.preventDefault();
        hold.release("key");
      }}
      onBlur={() => hold.cancel()}
      onClick={(event) => {
        event.preventDefault();
        // A pointer click reports how many presses made it; a click with no
        // press behind it comes from assistive tech that cannot hold.
        if (event.detail === 0) setConfirmOpen(true);
      }}
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
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipPopup side="top">
          <span className="inline-flex items-center gap-2">
            Press and hold to allow
            {showShortcutHint ? <Kbd className="text-[10px]">{`Hold ${shortcut}`}</Kbd> : null}
          </span>
        </TooltipPopup>
      </Tooltip>
      <span id={descriptionId} className="sr-only">
        {`${reason}. Press and hold for one second to allow${showShortcutHint ? `, or hold ${shortcut}` : ""}. Activating it without holding asks you to confirm.`}
      </span>
      <span className="sr-only" aria-live="polite">
        {holding ? "Keep holding to allow" : ""}
      </span>
      {/* Closed while a response is in flight, so it never asks twice. */}
      <AlertDialog open={confirmOpen && !disabled} onOpenChange={setConfirmOpen}>
        <AlertDialogPopup {...composerFloatingLayerProps}>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow this command?</AlertDialogTitle>
            <AlertDialogDescription>{`${reason}.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              size="sm"
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                setConfirmOpen(false);
                onConfirm();
              }}
            >
              Allow
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
