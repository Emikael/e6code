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

import {
  getClientSettings,
  useClientSettings,
  useUpdateClientSettings,
} from "../../hooks/useSettings";
import { unlockNotificationAudio } from "../../threadNotifications";
import { toastManager } from "../ui/toast";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  AttentionCard,
  AttentionSegmented,
  AttentionStartingPoints,
  ATTENTION_ROW_CLASS,
} from "./AttentionCard";
import {
  ATTENTION_PRESETS,
  presetSideEffects,
  presetUndoValues,
  resolveAttentionPreset,
  type AttentionPreset,
} from "./attentionPresets";
import { SettingResetButton, SettingsPageContainer, SettingsRow } from "./settingsLayout";
import { NotificationSettingsSection, requestSystemNotifications } from "./NotificationSettings";
import { searchableSetting } from "./settingsSearch";

const PRESET_TITLES = {
  quiet: "Quiet",
  standard: "Standard",
  detailed: "Detailed",
} satisfies Record<AttentionPreset, string>;

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

const AGENT_ACTIVITY_OPTIONS: ReadonlyArray<{
  readonly value: AgentActivityDetail;
  readonly label: string;
}> = [
  { value: "summary", label: "Summary" },
  { value: "live", label: "Live" },
];

const COMPOSER_CONTROLS_OPTIONS: ReadonlyArray<{
  readonly value: ComposerControls;
  readonly label: string;
}> = [
  { value: "compact", label: "Compact" },
  { value: "full", label: "Full" },
];

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
  // A starting point changes several controls at once, so it offers Undo.
  const choosePreset = (preset: AttentionPreset) => {
    const previous = presetUndoValues(getClientSettings());
    const effects = presetSideEffects(previous, preset);
    // Inside the click, as the Sound switch does, or the browser keeps audio locked.
    if (effects.unlockAudio) unlockNotificationAudio();
    updateSettings(ATTENTION_PRESETS[preset]);
    if (effects.requestNotifications) void requestSystemNotifications();
    toastManager.add({
      type: "success",
      title: `${PRESET_TITLES[preset]} starting point on`,
      description: "Each control below can still be changed on its own.",
      actionProps: { children: "Undo", onClick: () => updateSettings(previous) },
    });
  };

  return (
    // Board 6: an 880px page with 32px above the header.
    <SettingsPageContainer className="max-w-[880px] gap-6 sm:pt-8">
      <AttentionStartingPoints selected={startingPoint} onSelect={choosePreset} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-4">
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
              <AttentionSegmented
                label="Composer controls"
                value={composerControls}
                options={COMPOSER_CONTROLS_OPTIONS}
                onChange={(value) => updateSettings({ composerControls: value })}
              />
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
              <AttentionSegmented
                label="Agent activity"
                value={agentActivityDetail}
                options={AGENT_ACTIVITY_OPTIONS}
                onChange={(value) => updateSettings({ agentActivityDetail: value })}
              />
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
