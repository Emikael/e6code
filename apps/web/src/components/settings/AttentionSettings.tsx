/**
 * Settings → Attention: how much E6 Code asks of your attention.
 *
 * Laid out as the four groups of the Attention board (Notifications, Start
 * and layout, Threads, Time) in a two-column grid. Each group renders only
 * the rows that exist so far; later rows join their group without moving
 * the others. The starting-point tiles go above the grid.
 */
import {
  DEFAULT_CLIENT_SETTINGS,
  type AgentActivityDetail,
  type ComposerControls,
  type OpenThreadReminderAt,
  type RecapTrigger,
} from "@e6tools/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { NotificationSettingsSection } from "./NotificationSettings";
import { searchableSetting } from "./settingsSearch";

const RECAP_TRIGGER_LABELS = {
  "after-break": "After a break",
  always: "Always",
  never: "Never",
} satisfies Record<RecapTrigger, string>;

const OPEN_THREAD_REMINDER_OPTIONS: ReadonlyArray<{
  readonly value: OpenThreadReminderAt;
  readonly label: string;
}> = [
  { value: "off", label: "Off" },
  { value: 3, label: "At 3 threads" },
  { value: 5, label: "At 5 threads" },
  { value: 8, label: "At 8 threads" },
];

const openThreadReminderLabel = (value: OpenThreadReminderAt) =>
  OPEN_THREAD_REMINDER_OPTIONS.find((option) => option.value === value)?.label ?? "Off";

const AGENT_ACTIVITY_LABELS = {
  summary: "Summary",
  live: "Live",
} satisfies Record<AgentActivityDetail, string>;

const COMPOSER_CONTROLS_LABELS = {
  compact: "Compact",
  full: "Full",
} satisfies Record<ComposerControls, string>;

export function AttentionSettingsPanel() {
  const needsYouSectionEnabled = useClientSettings((s) => s.needsYouSectionEnabled);
  const sidebarElapsedTimeEnabled = useClientSettings((s) => s.sidebarElapsedTimeEnabled);
  const recapTrigger = useClientSettings((s) => s.recapTrigger);
  const composerControls = useClientSettings((s) => s.composerControls);
  const focusHoldsFinished = useClientSettings((s) => s.focusHoldsFinished);
  const openThreadReminderAt = useClientSettings((s) => s.openThreadReminderAt);
  const agentActivityDetail = useClientSettings((s) => s.agentActivityDetail);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsPageContainer>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-start gap-4">
        <NotificationSettingsSection />

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
          <SettingsRow
            {...searchableSetting("open-thread-reminder")}
            description="A quiet line in the composer when this many threads are open."
            resetAction={
              openThreadReminderAt !== DEFAULT_CLIENT_SETTINGS.openThreadReminderAt ? (
                <SettingResetButton
                  label="open-thread reminder"
                  onClick={() =>
                    updateSettings({
                      openThreadReminderAt: DEFAULT_CLIENT_SETTINGS.openThreadReminderAt,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={String(openThreadReminderAt)}
                onValueChange={(value) => {
                  const option = OPEN_THREAD_REMINDER_OPTIONS.find(
                    (candidate) => String(candidate.value) === value,
                  );
                  if (option) updateSettings({ openThreadReminderAt: option.value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={`Open-thread reminder: ${openThreadReminderLabel(openThreadReminderAt).toLowerCase()}`}
                >
                  <SelectValue>{openThreadReminderLabel(openThreadReminderAt)}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {OPEN_THREAD_REMINDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} hideIndicator value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("composer-controls")}
            description="Compact keeps effort, permissions and mode behind one chip."
            resetAction={
              composerControls !== DEFAULT_CLIENT_SETTINGS.composerControls ? (
                <SettingResetButton
                  label="composer controls"
                  onClick={() =>
                    updateSettings({ composerControls: DEFAULT_CLIENT_SETTINGS.composerControls })
                  }
                />
              ) : null
            }
            control={
              <ToggleGroup
                aria-label="Composer controls"
                variant="segmented"
                value={[composerControls]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "compact" || value === "full") {
                    updateSettings({ composerControls: value });
                  }
                }}
              >
                {Object.entries(COMPOSER_CONTROLS_LABELS).map(([value, label]) => (
                  <Toggle key={value} value={value}>
                    {label}
                  </Toggle>
                ))}
              </ToggleGroup>
            }
          />
        </SettingsSection>

        <SettingsSection id="attention-threads" title="Threads">
          <SettingsRow
            {...searchableSetting("recap-trigger")}
            description="A short recap built from the thread itself."
            resetAction={
              recapTrigger !== DEFAULT_CLIENT_SETTINGS.recapTrigger ? (
                <SettingResetButton
                  label="Where you left off"
                  onClick={() =>
                    updateSettings({ recapTrigger: DEFAULT_CLIENT_SETTINGS.recapTrigger })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={recapTrigger}
                onValueChange={(value) => {
                  if (value !== "after-break" && value !== "always" && value !== "never") return;
                  updateSettings({ recapTrigger: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={`Show where you left off: ${RECAP_TRIGGER_LABELS[recapTrigger].toLowerCase()}`}
                >
                  <SelectValue>{RECAP_TRIGGER_LABELS[recapTrigger]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(RECAP_TRIGGER_LABELS).map(([value, label]) => (
                    <SelectItem key={value} hideIndicator value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("agent-activity-detail")}
            description="Summary folds tool calls into one line. Live shows each step."
            resetAction={
              agentActivityDetail !== DEFAULT_CLIENT_SETTINGS.agentActivityDetail ? (
                <SettingResetButton
                  label="agent activity"
                  onClick={() =>
                    updateSettings({
                      agentActivityDetail: DEFAULT_CLIENT_SETTINGS.agentActivityDetail,
                    })
                  }
                />
              ) : null
            }
            control={
              <ToggleGroup
                aria-label="Agent activity"
                variant="segmented"
                value={[agentActivityDetail]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "summary" || value === "live") {
                    updateSettings({ agentActivityDetail: value });
                  }
                }}
              >
                {Object.entries(AGENT_ACTIVITY_LABELS).map(([value, label]) => (
                  <Toggle key={value} value={value}>
                    {label}
                  </Toggle>
                ))}
              </ToggleGroup>
            }
          />
          <SettingsRow
            {...searchableSetting("focus-holds-finished")}
            description="Anything that blocks an agent still comes through."
            resetAction={
              focusHoldsFinished !== DEFAULT_CLIENT_SETTINGS.focusHoldsFinished ? (
                <SettingResetButton
                  label="holding in focus mode"
                  onClick={() =>
                    updateSettings({
                      focusHoldsFinished: DEFAULT_CLIENT_SETTINGS.focusHoldsFinished,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={focusHoldsFinished}
                onCheckedChange={(checked) =>
                  updateSettings({ focusHoldsFinished: Boolean(checked) })
                }
                aria-label="Hold finished threads in focus mode"
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
                  label="Elapsed time"
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
