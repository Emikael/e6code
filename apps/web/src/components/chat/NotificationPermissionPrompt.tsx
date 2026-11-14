import { BellIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { canRequestSystemNotifications } from "../../threadNotifications";
import { Button } from "../ui/button";
import { shouldOfferNotificationPermission } from "./NotificationPermissionPrompt.logic";

const NOT_NOW_STORAGE_KEY = "e6:notification-permission-not-now-at";
function readNotNowAt(): number | null {
  try {
    const value = Number(window.localStorage.getItem(NOT_NOW_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** "Not now" in this page, for when storage is unavailable. */
let notNowThisPageAt: number | null = null;

function currentPermission(): NotificationPermission | null {
  return typeof Notification === "undefined" ? null : Notification.permission;
}

export interface NotificationPermissionOffer {
  /** "Claude", "Codex"; null when the provider is unknown. */
  readonly providerLabel: string | null;
  readonly turnOn: () => void;
  readonly notNow: () => void;
}

/**
 * The permission offer while a turn runs, or null. It goes when the turn ends
 * and returns on the next send.
 */
export function useNotificationPermissionOffer(input: {
  readonly working: boolean;
  /** "Claude", "Codex"; null when the provider is unknown. */
  readonly providerLabel: string | null;
}): NotificationPermissionOffer | null {
  const attentionNotifications = useClientSettings((settings) => settings.attentionNotifications);
  const [answerTick, setAnswerTick] = useState(0);
  const { working } = input;
  const offer = useMemo(() => {
    void answerTick;
    return shouldOfferNotificationPermission({
      working,
      supported: canRequestSystemNotifications(),
      permission: currentPermission(),
      attentionNotifications,
      notNowAtMs: readNotNowAt() ?? notNowThisPageAt,
      nowMs: Date.now(),
    });
  }, [answerTick, attentionNotifications, working]);

  const turnOn = useCallback(() => {
    void Notification.requestPermission()
      .catch(() => undefined)
      .finally(() => setAnswerTick((tick) => tick + 1));
  }, []);
  const notNow = useCallback(() => {
    notNowThisPageAt = Date.now();
    try {
      window.localStorage.setItem(NOT_NOW_STORAGE_KEY, String(Date.now()));
    } catch {
      // Storage is unavailable; the prompt still hides for this page.
    }
    setAnswerTick((tick) => tick + 1);
  }, []);

  const { providerLabel } = input;
  return useMemo(
    () => (offer ? { providerLabel, turnOn, notNow } : null),
    [notNow, offer, providerLabel, turnOn],
  );
}

/**
 * The Components board's permission card, in the slot above the composer: a
 * muted bell, the question as a wrapping sentence, Turn on and Not now.
 */
export function NotificationPermissionCard({ offer }: { offer: NotificationPermissionOffer }) {
  return (
    <section
      aria-label="Notifications"
      className="mb-2.5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-3.5 py-3"
    >
      <BellIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 basis-45 text-sm leading-[22px] text-foreground">
        {offer.providerLabel ?? "Your agent"} is working. Want a notification when it needs you or
        finishes?
      </p>
      <Button size="sm" variant="outline" className="sm:text-xs" onClick={offer.turnOn}>
        Turn on
      </Button>
      <Button size="sm" variant="ghost" className="sm:text-xs" onClick={offer.notNow}>
        Not now
      </Button>
    </section>
  );
}
