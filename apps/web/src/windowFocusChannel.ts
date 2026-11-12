/**
 * Which windows of the app, on this origin, have focus. Each window posts its
 * own focus changes on a BroadcastChannel, so a background window can leave
 * a notice to the focused one instead of raising a system notification for
 * the same event. Browsers without BroadcastChannel see no other windows.
 */
const CHANNEL_NAME = "e6code:window-focus";

interface FocusMessage {
  readonly windowId: string;
  readonly focused: boolean;
}

// Unique enough to tell this window's own messages from its siblings'.
const windowId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const focusedOthers = new Set<string>();
let channel: BroadcastChannel | null = null;
let subscribers = 0;
let teardown: (() => void) | null = null;

function isFocusMessage(value: unknown): value is FocusMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FocusMessage).windowId === "string" &&
    typeof (value as FocusMessage).focused === "boolean"
  );
}

function start() {
  if (typeof BroadcastChannel === "undefined") return;
  const current = new BroadcastChannel(CHANNEL_NAME);
  channel = current;
  const post = (focused: boolean) => {
    try {
      current.postMessage({ windowId, focused } satisfies FocusMessage);
    } catch {
      // A closed channel during unload; nothing to tell.
    }
  };
  const report = () => {
    const focused = document.visibilityState === "visible" && document.hasFocus();
    // Only one window holds focus, so this also clears a window that closed
    // without saying so.
    if (focused) focusedOthers.clear();
    post(focused);
  };
  const leave = () => post(false);
  current.addEventListener("message", (event) => {
    if (!isFocusMessage(event.data) || event.data.windowId === windowId) return;
    if (event.data.focused) focusedOthers.add(event.data.windowId);
    else focusedOthers.delete(event.data.windowId);
  });
  window.addEventListener("focus", report);
  window.addEventListener("blur", report);
  document.addEventListener("visibilitychange", report);
  window.addEventListener("pagehide", leave);
  report();
  teardown = () => {
    leave();
    window.removeEventListener("focus", report);
    window.removeEventListener("blur", report);
    document.removeEventListener("visibilitychange", report);
    window.removeEventListener("pagehide", leave);
    current.close();
    focusedOthers.clear();
  };
}

/** Starts sharing this window's focus; the returned function stops it. */
export function shareWindowFocus(): () => void {
  subscribers += 1;
  if (subscribers === 1) start();
  return () => {
    subscribers -= 1;
    if (subscribers > 0) return;
    teardown?.();
    teardown = null;
    channel = null;
  };
}

/** Another window of the app has focus right now. */
export function isAnotherWindowFocused(): boolean {
  return channel !== null && focusedOthers.size > 0;
}
