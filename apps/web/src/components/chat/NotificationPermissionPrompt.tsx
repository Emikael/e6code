import { BellIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { canRequestSystemNotifications } from "../../threadNotifications";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
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

/**
 * The inline permission card for the composer banner stack while a turn
 * runs, or null. It goes when the turn ends and returns on the next send.
 */
export function useNotificationPermissionBannerItem(input: {
  readonly working: boolean;
  /** "Claude", "Codex"; null when the provider is unknown. */
  readonly providerLabel: string | null;
}): ComposerBannerStackItem | null {
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
  return useMemo(() => {
    if (!offer) return null;
    return {
      id: "notification-permission",
      variant: "default",
      priority: "notice",
      icon: <BellIcon />,
      title: `${providerLabel ?? "Your agent"} is working. Want a notification when it needs you or finishes?`,
      actions: (
        <>
          <Button size="sm" variant="outline" className="sm:text-xs" onClick={turnOn}>
            Turn on
          </Button>
          <Button size="sm" variant="ghost" className="sm:text-xs" onClick={notNow}>
            Not now
          </Button>
        </>
      ),
    };
  }, [notNow, offer, providerLabel, turnOn]);
}
