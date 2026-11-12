import type { AttentionNotifications } from "@e6tools/contracts/settings";
import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";
import { useCallback, useEffect, useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { canRequestSystemNotifications, unlockNotificationAudio } from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export const ATTENTION_NOTIFICATION_LABELS = {
  blocked: "When an agent is blocked",
  all: "For every update",
  off: "Off",
} satisfies Record<AttentionNotifications, string>;

const NOTIFY_ME_DESCRIPTION = "Approvals, questions and failures count as blocked.";

type SystemNotificationState = NotificationPermission | "unsupported";

function readSystemNotificationState(): SystemNotificationState {
  return canRequestSystemNotifications() ? Notification.permission : "unsupported";
}

/**
 * The browser's notification permission for this origin. It can change in the
 * browser's own site settings, so it is read again when the window regains
 * focus and when the Permissions API reports a change.
 */
function useSystemNotificationState(): [SystemNotificationState, () => void] {
  const [state, setState] = useState(readSystemNotificationState);
  const refresh = useCallback(() => setState(readSystemNotificationState()), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    let status: PermissionStatus | null = null;
    let disposed = false;
    void navigator.permissions
      ?.query({ name: "notifications" })
      .then((result) => {
        if (disposed) return;
        status = result;
        status.addEventListener("change", refresh);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
      status?.removeEventListener("change", refresh);
    };
  }, [refresh]);
  return [state, refresh];
}

/** Asks the browser for system notifications; returns a note when they are unavailable. */
async function requestSystemNotifications(): Promise<string | null> {
  if (!canRequestSystemNotifications()) return null;
  if (Notification.permission !== "default") return null;
  try {
    await Notification.requestPermission();
    return null;
  } catch {
    return "System notifications are unavailable in this browser. In-app notices still appear.";
  }
}

/**
 * One line under Notify me that says whether this browser will show system
 * notifications, with the way to turn them on. Nothing while they work.
 */
function SystemNotificationStatus({
  state,
  onRequest,
}: {
  state: SystemNotificationState;
  onRequest: () => void;
}) {
  if (state === "granted") return null;
  if (state === "unsupported") {
    return (
      <span>
        System notifications need HTTPS or the desktop app. Until then they appear in E6 Code when
        you come back.
      </span>
    );
  }
  if (state === "denied") {
    return (
      <span>
        This browser blocks notifications from E6 Code. Allow them in the site settings next to the
        address bar, then come back. Until then they appear in E6 Code when you return.
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      System notifications are not on in this browser.
      <Button size="sm" variant="outline" onClick={onRequest}>
        Turn on
      </Button>
    </span>
  );
}

/** Settings → Attention → Notifications. Per device, like the permission it relies on. */
export function NotificationSettingsSection() {
  const attentionNotifications = useClientSettings((s) => s.attentionNotifications);
  const notifyWatchedThreads = useClientSettings((s) => s.notifyWatchedThreads);
  const holdFinishedUntilBreakpoint = useClientSettings((s) => s.holdFinishedUntilBreakpoint);
  const attentionSoundEnabled = useClientSettings((s) => s.attentionSoundEnabled);
  const updateSettings = useUpdateClientSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [systemState, refreshSystemState] = useSystemNotificationState();
  const requestPermission = () =>
    void requestSystemNotifications().then((message) => {
      setPermissionMessage(message);
      refreshSystemState();
    });

  return (
    <SettingsSection id="attention-notifications" title="Notifications">
      <SettingsRow
        {...searchableSetting("attention-notifications")}
        description={
          permissionMessage
            ? `${NOTIFY_ME_DESCRIPTION} ${permissionMessage}`
            : NOTIFY_ME_DESCRIPTION
        }
        status={
          attentionNotifications !== "off" ? (
            <SystemNotificationStatus state={systemState} onRequest={requestPermission} />
          ) : null
        }
        resetAction={
          attentionNotifications !== DEFAULT_CLIENT_SETTINGS.attentionNotifications ? (
            <SettingResetButton
              label="notifications"
              onClick={() =>
                updateSettings({
                  attentionNotifications: DEFAULT_CLIENT_SETTINGS.attentionNotifications,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={attentionNotifications}
            onValueChange={(value) => {
              if (value !== "blocked" && value !== "all" && value !== "off") return;
              updateSettings({ attentionNotifications: value });
              setPermissionMessage(null);
              if (value !== "off") requestPermission();
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-56"
              aria-label={`Notify me: ${ATTENTION_NOTIFICATION_LABELS[attentionNotifications].toLowerCase()}`}
            >
              <SelectValue>{ATTENTION_NOTIFICATION_LABELS[attentionNotifications]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(ATTENTION_NOTIFICATION_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("notify-watched-threads")}
        description="For threads you sent a message to. Change it per thread from the now bar."
        resetAction={
          notifyWatchedThreads !== DEFAULT_CLIENT_SETTINGS.notifyWatchedThreads ? (
            <SettingResetButton
              label="thread finished notifications"
              onClick={() =>
                updateSettings({
                  notifyWatchedThreads: DEFAULT_CLIENT_SETTINGS.notifyWatchedThreads,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={notifyWatchedThreads}
            onCheckedChange={(checked) =>
              updateSettings({ notifyWatchedThreads: Boolean(checked) })
            }
            aria-label="Tell me when my thread finishes"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("hold-finished-threads")}
        description="They arrive together when you send, switch thread or stop typing."
        resetAction={
          holdFinishedUntilBreakpoint !== DEFAULT_CLIENT_SETTINGS.holdFinishedUntilBreakpoint ? (
            <SettingResetButton
              label="holding finished threads"
              onClick={() =>
                updateSettings({
                  holdFinishedUntilBreakpoint: DEFAULT_CLIENT_SETTINGS.holdFinishedUntilBreakpoint,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={holdFinishedUntilBreakpoint}
            onCheckedChange={(checked) =>
              updateSettings({ holdFinishedUntilBreakpoint: Boolean(checked) })
            }
            aria-label="Hold other finished threads until a pause"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("attention-sound")}
        description="One short sound when an agent is blocked."
        resetAction={
          attentionSoundEnabled !== DEFAULT_CLIENT_SETTINGS.attentionSoundEnabled ? (
            <SettingResetButton
              label="sound"
              onClick={() =>
                updateSettings({
                  attentionSoundEnabled: DEFAULT_CLIENT_SETTINGS.attentionSoundEnabled,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={attentionSoundEnabled}
            onCheckedChange={(checked) => {
              if (checked) unlockNotificationAudio();
              updateSettings({ attentionSoundEnabled: Boolean(checked) });
            }}
            aria-label="Sound"
          />
        }
      />
    </SettingsSection>
  );
}
