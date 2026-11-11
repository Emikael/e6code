/**
 * Settings → Attention: how much E6 Code asks of your attention.
 *
 * Laid out as the four groups of the Attention board (Notifications, Start
 * and layout, Threads, Time) in a two-column grid. Each group renders only
 * the rows that exist so far; later rows join their group without moving
 * the others. The starting-point tiles go above the grid.
 */
import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function AttentionSettingsPanel() {
  const needsYouSectionEnabled = useClientSettings((s) => s.needsYouSectionEnabled);
  const sidebarElapsedTimeEnabled = useClientSettings((s) => s.sidebarElapsedTimeEnabled);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsPageContainer>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-start gap-4">
        <SettingsSection id="attention-start-and-layout" title="Start and layout">
          <SettingsRow
            {...searchableSetting("needs-you-section")}
            description="Blocked agents first, then work to review. The list below keeps its order."
            resetAction={
              needsYouSectionEnabled !== DEFAULT_CLIENT_SETTINGS.needsYouSectionEnabled ? (
                <SettingResetButton
                  label="Needs you section"
                  onClick={() =>
                    updateSettings({
                      needsYouSectionEnabled: DEFAULT_CLIENT_SETTINGS.needsYouSectionEnabled,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={needsYouSectionEnabled}
                onCheckedChange={(checked) =>
                  updateSettings({ needsYouSectionEnabled: Boolean(checked) })
                }
                aria-label="Needs you at the top of the sidebar"
              />
            }
          />
        </SettingsSection>

        <SettingsSection id="attention-time" title="Time">
          <SettingsRow
            {...searchableSetting("sidebar-elapsed-time")}
            description="Whole minutes only, so nothing ticks at the edge of your eye."
            resetAction={
              sidebarElapsedTimeEnabled !== DEFAULT_CLIENT_SETTINGS.sidebarElapsedTimeEnabled ? (
                <SettingResetButton
                  label="elapsed time"
                  onClick={() =>
                    updateSettings({
                      sidebarElapsedTimeEnabled: DEFAULT_CLIENT_SETTINGS.sidebarElapsedTimeEnabled,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={sidebarElapsedTimeEnabled}
                onCheckedChange={(checked) =>
                  updateSettings({ sidebarElapsedTimeEnabled: Boolean(checked) })
                }
                aria-label="Elapsed time in the thread list"
              />
            }
          />
        </SettingsSection>
      </div>
    </SettingsPageContainer>
  );
}
