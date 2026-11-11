import completionUrl from "./assets/notification-completion.mp3";
import inputUrl from "./assets/notification-input.mp3";

/** Whether this origin can show system notifications at all. */
export function canRequestSystemNotifications(): boolean {
  return typeof Notification !== "undefined" && window.isSecureContext;
}

/**
 * The desktop dock badge (Windows: taskbar overlay) as a standing count of
 * threads blocked on you, equal to the sidebar's Needs you badge.
 */
export function setDockBadge(count: number) {
  const bridge = window.desktopBridge;
  if (!bridge?.setNotificationBadge) return;
  // Only Windows draws its own overlay; macOS and Linux render the count.
  // The overlay takes the warning role, the colour of "blocked on you".
  const style = getComputedStyle(document.documentElement);
  const image =
    count > 0 && bridge.getClientPlatform?.() === "win32"
      ? drawBadgeImage(
          count,
          style.getPropertyValue("--warning-foreground").trim() || "#92400e",
          style.getPropertyValue("--primary-foreground").trim() || "white",
        )
      : null;
  void bridge.setNotificationBadge({ count, image }).catch(() => undefined);
}

function drawBadgeImage(count: number, fill: string, text: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = fill;
  context.beginPath();
  context.arc(32, 32, 28, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = text;
  context.font = `600 ${count > 9 ? 30 : 40}px "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(count > 9 ? "9+" : String(count), 32, 34);
  return canvas.toDataURL("image/png");
}

let audioContext: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();

/** Called from a gesture so browsers allow later background playback. */
export function unlockNotificationAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume().catch(() => undefined);
}

export async function playNotificationSound(
  kind: "completion" | "input",
  shouldPlay: () => boolean,
) {
  if (!audioContext || audioContext.state !== "running") return;
  const context = audioContext;
  const url = kind === "completion" ? completionUrl : inputUrl;
  try {
    let buffer = buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data));
      buffers.set(url, buffer);
    }
    const decoded = await buffer;
    if (!shouldPlay() || context.state !== "running") return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start();
  } catch {
    buffers.delete(url);
  }
}
