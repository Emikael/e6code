/** How long a destructive approval must be held before it is allowed. */
export const HOLD_TO_CONFIRM_MS = 1000;

/**
 * macOS and Electron send no keyup for Enter while ⌘ is down, so a held ⌘↵
 * is only trusted while the key keeps auto-repeating. The first repeat comes
 * after the OS repeat delay; later ones arrive every few tens of milliseconds.
 */
export const SHORTCUT_FIRST_REPEAT_GRACE_MS = 600;
export const SHORTCUT_REPEAT_WATCHDOG_MS = 150;

/** What is holding: the pointer, Enter/Space on the button, or a held ⌘↵. */
export type HoldSource = "pointer" | "key" | "shortcut";

/** Marks the composer and approval cards, where a held ⌘↵ allows a destructive command. */
const APPROVAL_SHORTCUT_SCOPE_ATTRIBUTE = "data-approval-shortcut-scope";

/** Rendered on every hold-to-allow button, so other ⌘↵ owners can tell one is waiting. */
const DESTRUCTIVE_APPROVAL_HOLD_ATTRIBUTE = "data-destructive-approval-hold";

/**
 * A held ⌘↵ allows only with focus inside the composer or an approval card,
 * so the shortcut keeps its meaning in terminals, editors, panels and dialogs.
 * Nothing focused (the body) is never in scope.
 */
export function approvalShortcutAppliesTo(focused: Element | null): boolean {
  return focused?.closest(`[${APPROVAL_SHORTCUT_SCOPE_ATTRIBUTE}]`) != null;
}

interface ShortcutKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
}

/**
 * Whether a keydown is the hold-to-allow ⌘↵ / Ctrl+↵. A handler that ran
 * first and claimed the key (the merge shortcut, a dialog) wins.
 */
export function approvalShortcutClaimsKeyDown(
  event: ShortcutKeyEvent,
  focused: Element | null,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey || event.altKey) return false;
  return approvalShortcutAppliesTo(focused);
}

/**
 * Whether a keyup ends a ⌘↵ hold: Enter or the modifier itself, or any key
 * released while ⌘/Ctrl is still down, since macOS may never report Enter's.
 */
export function approvalShortcutKeyUpReleases(
  event: Pick<ShortcutKeyEvent, "key" | "metaKey" | "ctrlKey">,
): boolean {
  return (
    event.key === "Enter" ||
    event.key === "Meta" ||
    event.key === "Control" ||
    event.metaKey ||
    event.ctrlKey
  );
}

/**
 * Whether a hold-to-allow button is on screen under `root`. Another ⌘↵
 * owner (the pull request merge) stands down while one is, so a single
 * keypress can never both open its dialog and start allowing a command.
 */
export function destructiveApprovalPendingIn(root: Pick<ParentNode, "querySelector">): boolean {
  return root.querySelector(`[${DESTRUCTIVE_APPROVAL_HOLD_ATTRIBUTE}]`) !== null;
}

export interface HoldToConfirm {
  /** Starts a hold that calls `onConfirm` if it lasts the full duration. */
  readonly press: (source: HoldSource, onConfirm: () => void) => void;
  /** An auto-repeat keydown from the source: a ⌘↵ hold lapses without them. */
  readonly repeat: (source: HoldSource) => void;
  readonly release: (source: HoldSource) => void;
  readonly cancel: () => void;
}

/**
 * Press-and-hold confirmation. Only the source that started a hold can end
 * it, so key repeat and a stray pointer event cannot restart or cut it short,
 * and one hold confirms at most once: the source must be released first.
 * A shortcut hold also ends when its key stops repeating.
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
    | {
        readonly status: "holding";
        readonly source: HoldSource;
        readonly timer: unknown;
        watchdog: unknown;
      }
    | { readonly status: "confirmed"; readonly source: HoldSource } = { status: "idle" };

  const reset = () => {
    const wasHolding = state.status === "holding";
    if (state.status === "holding") {
      clearTimer(state.timer);
      if (state.watchdog !== undefined) clearTimer(state.watchdog);
    }
    state = { status: "idle" };
    if (wasHolding) options.onHoldingChange(false);
  };
  const armWatchdog = (ms: number) => setTimer(reset, ms);

  return {
    press: (source, onConfirm) => {
      if (state.status !== "idle") return;
      const timer = setTimer(() => {
        if (state.status !== "holding") return;
        if (state.watchdog !== undefined) clearTimer(state.watchdog);
        state = { status: "confirmed", source: state.source };
        options.onHoldingChange(false);
        onConfirm();
      }, options.durationMs ?? HOLD_TO_CONFIRM_MS);
      const watchdog =
        source === "shortcut" ? armWatchdog(SHORTCUT_FIRST_REPEAT_GRACE_MS) : undefined;
      state = { status: "holding", source, timer, watchdog };
      options.onHoldingChange(true);
    },
    repeat: (source) => {
      if (state.status !== "holding" || state.source !== source) return;
      if (state.watchdog === undefined) return;
      clearTimer(state.watchdog);
      state.watchdog = armWatchdog(SHORTCUT_REPEAT_WATCHDOG_MS);
    },
    release: (source) => {
      if (state.status !== "idle" && state.source === source) reset();
    },
    cancel: reset,
  };
}
