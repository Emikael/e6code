import type { ClientSettings } from "@e6tools/contracts/settings";

/** "Not now" hides the prompt for a week. */
export const NOTIFICATION_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Whether to offer system notifications in the thread. Browsers only grant
 * the permission from a click, so it is asked inline while a turn runs and
 * the permission is still undecided. It names the working agent, so it goes
 * when the turn ends and returns with the next one until answered. Per
 * origin: a new tunnel address asks again.
 */
export function shouldOfferNotificationPermission(input: {
  /** A turn is running in the open thread. */
  readonly working: boolean;
  readonly supported: boolean;
  readonly permission: NotificationPermission | null;
  readonly attentionNotifications: ClientSettings["attentionNotifications"];
  readonly notNowAtMs: number | null;
  readonly nowMs: number;
}): boolean {
  return (
    input.working &&
    input.supported &&
    input.permission === "default" &&
    input.attentionNotifications !== "off" &&
    (input.notNowAtMs === null || input.nowMs - input.notNowAtMs >= NOTIFICATION_PROMPT_SNOOZE_MS)
  );
}
