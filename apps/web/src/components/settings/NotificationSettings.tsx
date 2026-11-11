import type { AttentionNotifications } from "@e6tools/contracts/settings";
import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";
import { useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { canRequestSystemNotifications, unlockNotificationAudio } from "../../threadNotifications";
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

/** Asks the browser for system notifications; returns a note when they are unavailable. */
async function requestSystemNotifications(): Promise<string | null> {
  if (!canRequestSystemNotifications()) {
    return "System notifications need a supported browser over HTTPS, or the desktop app. In-app notices still appear.";
  }
  if (Notification.permission === "granted") return null;
  try {
    const permission = await Notification.requestPermission();
    return permission === "granted"
      ? null
      : "Allow notifications in your browser or system settings to get them while E6 Code is in the background.";
  } catch {
    return "System notifications are unavailable in this browser. In-app notices still appear.";
  }
}

/** Settings → Attention → Notifications. Per device, like the permission it relies on. */
export function NotificationSettingsSection() {
  const attentionNotifications = useClientSettings((s) => s.attentionNotifications);
  const notifyWatchedThreads = useClientSettings((s) => s.notifyWatchedThreads);
  const holdFinishedUntilBreakpoint = useClientSettings((s) => s.holdFinishedUntilBreakpoint);
  const attentionSoundEnabled = useClientSettings((s) => s.attentionSoundEnabled);
  const updateSettings = useUpdateClientSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);

  return (
    <SettingsSection id="attention-notifications" title="Notifications">
      <SettingsRow
        {...searchableSetting("attention-notifications")}
        description={
          permissionMessage ? (
            <>
              {NOTIFY_ME_DESCRIPTION} {permissionMessage}
            </>
          ) : (
            NOTIFY_ME_DESCRIPTION
          )
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
              if (value !== "off") void requestSystemNotifications().then(setPermissionMessage);
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
