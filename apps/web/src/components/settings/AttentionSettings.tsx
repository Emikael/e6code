/**
 * Settings → Attention: how much E6 Code asks of your attention (board 6).
 *
 * Three starting points on top, then the four groups of the board
 * (Notifications, Start and layout, Threads, Time) as cards in a two-column
 * grid, each with its heading inside.
 */
import {
  DEFAULT_CLIENT_SETTINGS,
  type AgentActivityDetail,
  type BreakReminderMinutes,
  type ComposerControls,
  type OpenThreadReminderAt,
  type RecapTrigger,
} from "@e6tools/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { AttentionCard, AttentionStartingPoints, ATTENTION_ROW_CLASS } from "./AttentionCard";
import { ATTENTION_PRESETS, resolveAttentionPreset } from "./attentionPresets";
import { SettingResetButton, SettingsPageContainer, SettingsRow } from "./settingsLayout";
import { NotificationSettingsSection } from "./NotificationSettings";
import { searchableSetting } from "./settingsSearch";

/** Board 6's segmented control: a well with the chosen option raised and outlined. */
export const ATTENTION_SEGMENT_GROUP_CLASS = "rounded-lg bg-surface-well p-0.5";
export const ATTENTION_SEGMENT_CLASS =
  "h-[26px] px-2.5 data-pressed:bg-card data-pressed:shadow-none data-pressed:ring-1 data-pressed:ring-inset data-pressed:ring-primary-edge dark:data-pressed:bg-card";

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

const BREAK_REMINDER_OPTIONS: ReadonlyArray<{
  readonly value: BreakReminderMinutes;
  readonly label: string;
}> = [
  { value: "off", label: "Off" },
  { value: 25, label: "After 25 minutes" },
  { value: 50, label: "After 50 minutes" },
  { value: 90, label: "After 90 minutes" },
];

const breakReminderLabel = (value: BreakReminderMinutes) =>
  BREAK_REMINDER_OPTIONS.find((option) => option.value === value)?.label ?? "Off";

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
  const sessionClockEnabled = useClientSettings((s) => s.sessionClockEnabled);
  const breakReminderMinutes = useClientSettings((s) => s.breakReminderMinutes);
  const startingPoint = useClientSettings(resolveAttentionPreset);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsPageContainer className="gap-6">
      <AttentionStartingPoints
        selected={startingPoint}
        onSelect={(preset) => updateSettings(ATTENTION_PRESETS[preset])}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-start gap-4">
        <NotificationSettingsSection />

        <AttentionCard id="attention-start-and-layout" title="Start and layout">
          <SettingsRow
            {...searchableSetting("needs-you-section")}
            className={ATTENTION_ROW_CLASS}
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
            className={ATTENTION_ROW_CLASS}
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
                  className="w-full sm:w-auto"
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
            className={ATTENTION_ROW_CLASS}
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
                className={ATTENTION_SEGMENT_GROUP_CLASS}
                value={[composerControls]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "compact" || value === "full") {
                    updateSettings({ composerControls: value });
                  }
                }}
              >
                {Object.entries(COMPOSER_CONTROLS_LABELS).map(([value, label]) => (
                  <Toggle key={value} value={value} className={ATTENTION_SEGMENT_CLASS}>
                    {label}
                  </Toggle>
                ))}
              </ToggleGroup>
            }
          />
        </AttentionCard>

        <AttentionCard id="attention-threads" title="Threads">
          <SettingsRow
            {...searchableSetting("recap-trigger")}
            className={ATTENTION_ROW_CLASS}
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
                  className="w-full sm:w-auto"
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
            className={ATTENTION_ROW_CLASS}
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
                className={ATTENTION_SEGMENT_GROUP_CLASS}
                value={[agentActivityDetail]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "summary" || value === "live") {
                    updateSettings({ agentActivityDetail: value });
                  }
                }}
              >
                {Object.entries(AGENT_ACTIVITY_LABELS).map(([value, label]) => (
                  <Toggle key={value} value={value} className={ATTENTION_SEGMENT_CLASS}>
                    {label}
                  </Toggle>
                ))}
              </ToggleGroup>
            }
          />
          <SettingsRow
            {...searchableSetting("focus-holds-finished")}
            className={ATTENTION_ROW_CLASS}
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
        </AttentionCard>

        <AttentionCard id="attention-time" title="Time">
          <SettingsRow
            {...searchableSetting("sidebar-elapsed-time")}
            className={ATTENTION_ROW_CLASS}
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
          <SettingsRow
            {...searchableSetting("session-clock")}
            className={ATTENTION_ROW_CLASS}
            description="Shows how long E6 Code has been open today."
            resetAction={
              sessionClockEnabled !== DEFAULT_CLIENT_SETTINGS.sessionClockEnabled ? (
                <SettingResetButton
                  label="Session clock"
                  onClick={() =>
                    updateSettings({
                      sessionClockEnabled: DEFAULT_CLIENT_SETTINGS.sessionClockEnabled,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={sessionClockEnabled}
                onCheckedChange={(checked) =>
                  updateSettings({ sessionClockEnabled: Boolean(checked) })
                }
                aria-label="Session clock"
              />
            }
          />
          <SettingsRow
            {...searchableSetting("break-reminder")}
            className={ATTENTION_ROW_CLASS}
            description="A quiet line in the header. It never interrupts."
            resetAction={
              breakReminderMinutes !== DEFAULT_CLIENT_SETTINGS.breakReminderMinutes ? (
                <SettingResetButton
                  label="Break reminder"
                  onClick={() =>
                    updateSettings({
                      breakReminderMinutes: DEFAULT_CLIENT_SETTINGS.breakReminderMinutes,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={String(breakReminderMinutes)}
                onValueChange={(value) => {
                  const option = BREAK_REMINDER_OPTIONS.find(
                    (candidate) => String(candidate.value) === value,
                  );
                  if (option) updateSettings({ breakReminderMinutes: option.value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-auto"
                  aria-label={`Break reminder: ${breakReminderLabel(breakReminderMinutes).toLowerCase()}`}
                >
                  <SelectValue>{breakReminderLabel(breakReminderMinutes)}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {BREAK_REMINDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} hideIndicator value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        </AttentionCard>
      </div>
    </SettingsPageContainer>
  );
}
