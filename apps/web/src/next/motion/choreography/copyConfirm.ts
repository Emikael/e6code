import { useEffect, useState } from "react";

/** How long Copy shows its check and "Copied" (design direction 3.9). A hold, not a tween. */
export const COPY_CONFIRM_HOLD_MS = 1200;

interface Clock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * The copy confirmation's state: `confirm()` shows the check, which reverts after the hold.
 * Copying again restarts the hold. The swap itself is `iconSwap`.
 */
export const createCopyConfirm = (onChange: (copied: boolean) => void, clock: Clock) => {
  let handle: unknown;
  let copied = false;
  const set = (next: boolean) => {
    if (next === copied) return;
    copied = next;
    onChange(next);
  };
  return {
    confirm() {
      if (handle !== undefined) clock.clearTimeout(handle);
      set(true);
      handle = clock.setTimeout(() => {
        handle = undefined;
        set(false);
      }, COPY_CONFIRM_HOLD_MS);
    },
    dispose() {
      if (handle !== undefined) clock.clearTimeout(handle);
      handle = undefined;
    },
  };
};

const browserClock: Clock = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `[copied, confirm]` for a Copy control. */
export const useCopyConfirm = (): readonly [boolean, () => void] => {
  const [copied, setCopied] = useState(false);
  const [controller] = useState(() => createCopyConfirm(setCopied, browserClock));
  useEffect(() => () => controller.dispose(), [controller]);
  return [copied, controller.confirm] as const;
};
