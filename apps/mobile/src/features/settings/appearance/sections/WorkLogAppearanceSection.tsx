import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

/** Device-local, like the accent: mobile has no client-settings sync. */
export function WorkLogAppearanceSection() {
  const { isReady, appearance, setShowThinkingTimeline } = useAppearancePreferences();
  return (
    <SettingsSection title="Work log">
      <SettingsSwitchRow
        disabled={!isReady}
        icon="brain"
        label="Thinking timeline"
        subtitle="Show an opened work log as a timeline, with each step's duration."
        onValueChange={setShowThinkingTimeline}
        value={appearance.showThinkingTimeline}
      />
    </SettingsSection>
  );
}
