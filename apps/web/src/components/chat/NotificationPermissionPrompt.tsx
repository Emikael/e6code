import { BellIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

function currentPermission(): NotificationPermission | null {
  return typeof Notification === "undefined" ? null : Notification.permission;
}

// Once offered, the prompt stays until answered, even after the turn ends.
let offeredThisSession = false;

/** The inline permission card for the composer banner stack, or null. */
export function useNotificationPermissionBannerItem(input: {
  readonly working: boolean;
  /** "Claude", "Codex"; null when the provider is unknown. */
  readonly providerLabel: string | null;
}): ComposerBannerStackItem | null {
  const attentionNotifications = useClientSettings((settings) => settings.attentionNotifications);
  const [answerTick, setAnswerTick] = useState(0);
  const eligible = useMemo(() => {
    void answerTick;
    return shouldOfferNotificationPermission({
      supported: canRequestSystemNotifications(),
      permission: currentPermission(),
      attentionNotifications,
      notNowAtMs: readNotNowAt(),
      nowMs: Date.now(),
    });
  }, [answerTick, attentionNotifications]);
  const [offered, setOffered] = useState(offeredThisSession);
  useEffect(() => {
    if (!eligible || !input.working || offered) return;
    offeredThisSession = true;
    setOffered(true);
  }, [eligible, input.working, offered]);

  const turnOn = useCallback(() => {
    void Notification.requestPermission()
      .catch(() => undefined)
      .finally(() => setAnswerTick((tick) => tick + 1));
  }, []);
  const notNow = useCallback(() => {
    try {
      window.localStorage.setItem(NOT_NOW_STORAGE_KEY, String(Date.now()));
    } catch {
      // Storage is unavailable; the prompt still hides for this session.
    }
    offeredThisSession = false;
    setOffered(false);
    setAnswerTick((tick) => tick + 1);
  }, []);

  const { providerLabel } = input;
  return useMemo(() => {
    if (!eligible || !offered) return null;
    return {
      id: "notification-permission",
      variant: "default",
      priority: "notice",
      icon: <BellIcon />,
      title: `${providerLabel ?? "Your agent"} is working. Want a notification when it needs you or finishes?`,
      actions: (
        <>
          <Button size="sm" variant="outline" onClick={turnOn}>
            Turn on
          </Button>
          <Button size="sm" variant="ghost" onClick={notNow}>
            Not now
          </Button>
        </>
      ),
    };
  }, [eligible, notNow, offered, providerLabel, turnOn]);
}
