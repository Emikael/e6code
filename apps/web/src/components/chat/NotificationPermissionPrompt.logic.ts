import type { ClientSettings } from "@e6tools/contracts/settings";

/** "Not now" hides the prompt for a week. */
export const NOTIFICATION_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Whether to offer system notifications in the thread. Browsers only grant
 * the permission from a click, so it is asked inline the first time a turn
 * runs while the permission is still undecided. Per origin: a new tunnel
 * address asks again.
 */
export function shouldOfferNotificationPermission(input: {
  readonly supported: boolean;
  readonly permission: NotificationPermission | null;
  readonly attentionNotifications: ClientSettings["attentionNotifications"];
  readonly notNowAtMs: number | null;
  readonly nowMs: number;
}): boolean {
  return (
    input.supported &&
    input.permission === "default" &&
    input.attentionNotifications !== "off" &&
    (input.notNowAtMs === null || input.nowMs - input.notNowAtMs >= NOTIFICATION_PROMPT_SNOOZE_MS)
  );
}
