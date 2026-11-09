/** How long a destructive approval must be held before it is allowed. */
export const HOLD_TO_CONFIRM_MS = 1000;

/** What is holding: the pointer, Enter/Space on the button, or ⌘↵ anywhere. */
export type HoldSource = "pointer" | "key" | "shortcut";

export interface HoldToConfirm {
  /** Starts a hold that calls `onConfirm` if it lasts the full duration. */
  readonly press: (source: HoldSource, onConfirm: () => void) => void;
  readonly release: (source: HoldSource) => void;
  readonly cancel: () => void;
}

/**
 * Press-and-hold confirmation. Only the source that started a hold can end
 * it, so key repeat and a stray pointer event cannot restart or cut it short,
 * and one hold confirms at most once: the source must be released first.
 */
export function createHoldToConfirm(options: {
  readonly durationMs?: number;
  readonly onHoldingChange: (holding: boolean) => void;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}): HoldToConfirm {
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let state:
    | { readonly status: "idle" }
    | { readonly status: "holding"; readonly source: HoldSource; readonly timer: unknown }
    | { readonly status: "confirmed"; readonly source: HoldSource } = { status: "idle" };

  const reset = () => {
    const wasHolding = state.status === "holding";
    if (state.status === "holding") clearTimer(state.timer);
    state = { status: "idle" };
    if (wasHolding) options.onHoldingChange(false);
  };

  return {
    press: (source, onConfirm) => {
      if (state.status !== "idle") return;
      const timer = setTimer(() => {
        if (state.status !== "holding") return;
        state = { status: "confirmed", source: state.source };
        options.onHoldingChange(false);
        onConfirm();
      }, options.durationMs ?? HOLD_TO_CONFIRM_MS);
      state = { status: "holding", source, timer };
      options.onHoldingChange(true);
    },
    release: (source) => {
      if (state.status !== "idle" && state.source === source) reset();
    },
    cancel: reset,
  };
}
