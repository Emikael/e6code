import { ProviderDriverKind } from "@e6tools/contracts";
import { BUILT_IN_THEMES } from "@e6tools/shared/themePalettes";
import { DndContext } from "@dnd-kit/core";
import { CircleCheck, Clock3, MoreHorizontal, Pin, Server, ShieldQuestion } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { TooltipProvider } from "~/components/ui/tooltip";
import { BranchDragChip } from "~/components/sidebar/BranchDragChip";
import { BranchLane } from "~/components/sidebar/BranchLane";
import { SidebarGroupByRow, type SidebarDensity } from "~/components/sidebar/SidebarGroupByRow";
import {
  BranchThreadRow,
  BranchThreadRowActions,
  type BranchThreadRowProps,
} from "~/components/sidebar/BranchThreadRow";
import { BranchLabel } from "~/components/sidebar/primitives/BranchLabel";
import { CountBadge } from "~/components/sidebar/primitives/CountBadge";
import { DiffStat } from "~/components/sidebar/primitives/DiffStat";
import { KbdHint } from "~/components/sidebar/primitives/KbdHint";
import { LaneHeader } from "~/components/sidebar/primitives/LaneHeader";
import { PlanProgress } from "~/components/sidebar/primitives/PlanProgress";
import { ProviderMark } from "~/components/sidebar/primitives/ProviderMark";
import { QuickActions, type QuickAction } from "~/components/sidebar/primitives/QuickActions";
import { StatusGlyph } from "~/components/sidebar/primitives/StatusGlyph";
import { StatusPill } from "~/components/sidebar/primitives/StatusPill";
import { SWITCHBOARD_STATUS, type SwitchboardStatus } from "~/components/sidebar/primitives/status";
import { UsageMeter } from "~/components/sidebar/primitives/UsageMeter";
import { AttentionItem } from "~/components/settings/primitives/AttentionItem";
import { ChangedDot } from "~/components/settings/primitives/ChangedDot";
import { ResetButton } from "~/components/settings/primitives/ResetButton";
import { ScopeChip } from "~/components/settings/primitives/ScopeChip";
import { SettingRow } from "~/components/settings/primitives/SettingRow";
import { UnsavedBar } from "~/components/settings/primitives/UnsavedBar";
import { useCustomThemes } from "~/hooks/useCustomThemes";
import { applyThemePalette, getCustomThemes, getEnvironmentThemes } from "~/themePalette";
import type { SidebarGroupBy } from "~/components/Sidebar.logic";
import { auditPrimitiveText } from "./contrast";
import "~/index.css";

function getFixtureThemes(customThemes = getCustomThemes()) {
  return [
    { id: "default", label: "E6 Code" },
    ...BUILT_IN_THEMES,
    ...customThemes,
    ...getEnvironmentThemes(),
  ].filter((theme, index, themes) => themes.findIndex((item) => item.id === theme.id) === index);
}
const inputClass =
  "w-full rounded-[5px] border border-sb-border bg-sb-surface px-2 py-1 text-sb-foreground";

function setTheme(theme: string, dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  applyThemePalette(theme, dark ? "dark" : "light");
}

export function runContrastAudit() {
  const previousTheme = document.documentElement.dataset.themeId ?? "default";
  const previousDark = document.documentElement.classList.contains("dark");
  try {
    return getFixtureThemes().flatMap((theme) =>
      [false, true].map((dark) => {
        const appearance = dark ? "dark" : "light";
        setTheme(theme.id, dark);
        return {
          theme: theme.id,
          appearance,
          ...auditPrimitiveText({ theme: theme.id, appearance }),
        };
      }),
    );
  } finally {
    setTheme(previousTheme, previousDark);
  }
}

function Sample({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 border-b border-sb-border p-4">
      <h2 className="font-medium">{name}</h2>
      {children}
    </section>
  );
}

function FixtureBranchRow({
  actions,
  ...props
}: BranchThreadRowProps & { actions?: readonly QuickAction[] }) {
  return (
    <li role="presentation" className="group/sidebar-row relative">
      <div
        role="option"
        aria-selected={props.selected ?? false}
        tabIndex={0}
        className="rounded-lg"
      >
        <BranchThreadRow {...props} actionCount={actions?.length ?? 0} />
      </div>
      {actions && (
        <BranchThreadRowActions
          visible={props.actionsVisible ?? false}
          density={props.density ?? "comfortable"}
        >
          <QuickActions actions={actions} variant="row" />
        </BranchThreadRowActions>
      )}
    </li>
  );
}

export function SwitchboardFixture() {
  const themes = getFixtureThemes(useCustomThemes());
  const [theme, selectTheme] = useState("default");
  const [dark, setDark] = useState(true);
  const [message, setMessage] = useState("Ready for interaction checks");
  const [pinned, setPinned] = useState(false);
  const [value, setValue] = useState("--verbose");
  const [dirty, setDirty] = useState(true);
  const [audit, setAudit] = useState<ReturnType<typeof runContrastAudit>>();
  const [groupBy, setGroupBy] = useState("branch");
  const [density, setDensity] = useState("comfortable");
  const [expanded, setExpanded] = useState(true);
  const [headerGroupBy, setHeaderGroupBy] = useState<SidebarGroupBy>("branch");
  const [headerDensity, setHeaderDensity] = useState<SidebarDensity>("comfortable");
  useEffect(() => setTheme(theme, dark), [theme, dark]);
  const reset = () => {
    setValue("");
    setDirty(false);
    setMessage("Restored default");
  };
  const actions = [
    {
      id: "pin",
      label: pinned ? "Unpin thread" : "Pin thread",
      icon: Pin,
      pressed: pinned,
      onClick: () => {
        setPinned(!pinned);
        setMessage(pinned ? "Unpinned" : "Pinned");
      },
    },
    {
      id: "snooze",
      label: "Snooze thread",
      icon: Clock3,
      onClick: () => setMessage("Snooze requested"),
    },
    {
      id: "settle",
      label: "Settle thread",
      icon: CircleCheck,
      disabled: true,
      onClick: () => setMessage("Unexpected disabled action"),
    },
    {
      id: "more",
      label: "More thread actions",
      icon: MoreHorizontal,
      onClick: () => setMessage("More actions requested"),
    },
  ];
  const branchMeta = (
    <>
      <ProviderMark provider={ProviderDriverKind.make("codex")} label="Codex · GPT-5" />
      <span data-sb-model className="min-w-0 truncate">
        GPT-5
      </span>
      <DiffStat additions={84} deletions={12} />
      <span className="inline-flex shrink-0 items-center gap-1">
        <Server aria-hidden="true" className="size-3" />
        <span data-sb-environment-label>Mac mini</span>
      </span>
    </>
  );
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background p-4 font-sans text-[13px] text-foreground">
        <header className="mb-4 flex flex-wrap items-center gap-4">
          <h1 className="font-semibold text-lg">Switchboard primitives</h1>
          <label>
            Theme{" "}
            <select
              aria-label="Theme"
              className="rounded border border-border bg-background px-2 py-1"
              value={theme}
              onChange={(e) => selectTheme(e.target.value)}
            >
              {themes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            Dark
          </label>
          <Button
            variant="chip"
            className="sb-action px-2"
            onClick={() => setAudit(runContrastAudit())}
          >
            Run contrast audit
          </Button>
          <output role="status">{message}</output>
        </header>
        {audit && (
          <pre
            data-audit-result
            className="mb-4 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border p-3"
          >
            {JSON.stringify(audit, null, 2)}
          </pre>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
          <div
            data-switchboard="sidebar"
            data-contrast-fixture
            className="@container/sidebar-column overflow-hidden rounded-xl border border-sb-border bg-sb-surface text-sb-foreground"
          >
            <Sample name="StatusGlyph · StatusPill · CountBadge">
              {(Object.keys(SWITCHBOARD_STATUS) as SwitchboardStatus[]).map((status, index) => (
                <div key={status} className="flex items-center gap-3">
                  <StatusGlyph status={status} />
                  <StatusPill status={status} />
                  <CountBadge count={index} label="threads" status={status} />
                </div>
              ))}
              <div className="flex gap-2">
                {[0, 1, 99, 1000].map((count) => (
                  <CountBadge key={count} count={count} label="threads" />
                ))}
              </div>
            </Sample>
            <Sample name="BranchLabel · DiffStat · ProviderMark · KbdHint">
              <BranchLabel branch="feature/switchboard-with-a-long-branch-name" worktree />
              <BranchLabel branch={null} />
              <div className="flex gap-4">
                <DiffStat additions={84} deletions={12} />
                <DiffStat additions={0} deletions={0} />
                <DiffStat />
              </div>
              <div className="flex items-center gap-3">
                {[
                  "codex",
                  "claudeAgent",
                  "cursor",
                  "grok",
                  "opencode",
                  "antigravity",
                  "custom",
                ].map((provider) => (
                  <ProviderMark
                    key={provider}
                    provider={ProviderDriverKind.make(provider)}
                    label={provider}
                  />
                ))}
                <KbdHint>⌘ ↵</KbdHint>
              </div>
            </Sample>
            <Sample name="UsageMeter">
              {[0, 62, 79, 80, 94, 95, 100, null].map((percent) => (
                <div key={String(percent)}>
                  <UsageMeter label="Weekly" percent={percent} />
                </div>
              ))}
            </Sample>
            <Sample name="PlanProgress">
              <PlanProgress completed={0} total={0} />
              <PlanProgress completed={0} total={7} currentStep="Prepare fixture" />
              <PlanProgress completed={3} total={7} currentStep="Extract primitives" />
              <PlanProgress completed={7} total={7} currentStep="Complete" />
            </Sample>
            <Sample name="QuickActions · LaneHeader">
              <QuickActions actions={actions} />
              <LaneHeader
                branch="feature/switchboard"
                count={3}
                expanded={expanded}
                controlsId="fixture-lane"
                worktree
                metadata={<StatusPill status="working" />}
                onToggle={() => setExpanded(!expanded)}
              />
              <div id="fixture-lane" hidden={!expanded}>
                Three threads in this lane
              </div>
              <LaneHeader
                branch={null}
                count={0}
                expanded={false}
                onToggle={() => setMessage("Empty lane selected")}
              />
              <label className="block">
                Group by{" "}
                <select
                  aria-label="Group by"
                  className={inputClass}
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                >
                  {["status", "branch", "project"].map((group) => (
                    <option key={group}>{group}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                Density{" "}
                <select
                  aria-label="Density"
                  className={inputClass}
                  value={density}
                  onChange={(e) => setDensity(e.target.value)}
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
            </Sample>
            <Sample name="Header row · Group by · Density">
              <SidebarGroupByRow
                groupBy={headerGroupBy}
                allProjects
                onGroupByChange={setHeaderGroupBy}
                density={headerDensity}
                onDensityChange={setHeaderDensity}
              />
              <SidebarGroupByRow
                groupBy="branch"
                allProjects={false}
                onGroupByChange={() => setMessage("Single-project scope")}
                density="compact"
                onDensityChange={() => setMessage("Single-project scope")}
              />
            </Sample>
            <Sample name="Lane headers · meta, collapse, status sections">
              <div className="flex flex-col gap-1.5">
                <LaneHeader
                  branch="feature/live-open"
                  count={1}
                  live
                  pullRequest={{ number: 128, url: "#pr-128", state: "open", count: 2 }}
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch="feature/draft"
                  count={2}
                  pullRequest={{ number: 131, url: "#pr-131", state: "draft", count: 1 }}
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch="feature/merged"
                  count={2}
                  pullRequest={{ number: 120, url: "#pr-120", state: "merged", count: 1 }}
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch="fix/closed"
                  count={1}
                  pullRequest={{ number: 99, url: "#pr-99", state: "closed", count: 1 }}
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch="feature/unsynced"
                  count={1}
                  pullRequest={{ number: 140, url: "#pr-140", state: null, count: 1 }}
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch="feature/merged-worktree"
                  worktree
                  count={1}
                  pullRequest={{ number: 200, url: "#pr-200", state: "merged", count: 1 }}
                  cleanUp
                  cleanUpLink={<a href="#settings-storage" />}
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch="feature/collapsed"
                  count={4}
                  expanded={false}
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch="feature/collapsed-open"
                  count={3}
                  expanded={false}
                  containsOpenThread
                  onToggle={() => setMessage("Lane toggled")}
                />
                <LaneHeader
                  branch={null}
                  pinned
                  count={2}
                  expanded={false}
                  onToggle={() => setMessage("Pinned toggled")}
                />
                {(["needs-you", "error", "running", "idle"] as const).map((status, index) => (
                  <LaneHeader key={status} branch={null} status={status} count={index + 1} />
                ))}
              </div>
            </Sample>
            <Sample name="Masthead environment pills">
              {/* Mirrors ProjectMasthead's pill classes so the audit covers them. */}
              <div className="flex gap-2">
                <span className="inline-flex h-[18px] items-center rounded-full bg-(--state-working)/12 px-1.5 text-[10px] leading-none font-semibold tracking-wide text-(--state-working)">
                  Dev
                </span>
                <span className="inline-flex h-[18px] items-center rounded-full bg-(--state-approval)/12 px-1.5 text-[10px] leading-none font-semibold tracking-wide text-(--state-approval)">
                  Nightly
                </span>
              </div>
            </Sample>
            <Sample name="Shelf headers (switchboard)">
              {/* Mirrors SidebarSectionHeader's switchboard classes: rest, then drop target. */}
              {(["Snoozed (2)", "Settled (14)"] as const).map((label) => (
                <div key={label} className="flex h-8 items-center">
                  <span className="flex w-full items-center gap-2 px-2 text-xs font-medium text-sb-muted">
                    <span className="shrink-0">{label}</span>
                    <span aria-hidden className="h-px min-w-2 flex-1 bg-sb-border" />
                  </span>
                </div>
              ))}
              <div className="flex h-8 items-center rounded-md bg-sb-selection shadow-[inset_0_0_0_1px_var(--sb-accent)]">
                <span className="flex w-full items-center gap-2 px-2 text-xs font-medium text-sb-foreground">
                  <span className="shrink-0">Settled</span>
                  <span aria-hidden className="h-px min-w-2 flex-1 bg-sb-accent" />
                </span>
              </div>
            </Sample>
            <Sample name="Branch lanes · Comfortable rows">
              <DndContext>
                <ul role="listbox" aria-label="Fixture threads" aria-multiselectable>
                  <BranchLane laneKey="fixture:pinned" branch={null} count={1} pinned>
                    <FixtureBranchRow
                      title="Design review notes: Switchboard"
                      status="ready"
                      age="2d"
                      meta={
                        <>
                          <BranchLabel branch="main" className="shrink-[50]" />
                          {branchMeta}
                          <Pin role="img" aria-label="Pinned" className="size-3 shrink-0" />
                        </>
                      }
                      actions={actions}
                    />
                  </BranchLane>
                  <BranchLane
                    laneKey="fixture:working"
                    branch="feature/auth-gate"
                    worktree
                    count={3}
                    projectName="e6code"
                  >
                    <FixtureBranchRow
                      title="Apply auth middleware to /api/agents"
                      status="working"
                      age="11:40"
                      meta={branchMeta}
                      actions={actions}
                      planProgress={{
                        step: "Extract requireSession() helper",
                        completedSteps: 3,
                        totalSteps: 7,
                      }}
                    />
                    <FixtureBranchRow
                      title="Neutral theme tokens + AA pass"
                      status="ready"
                      age="42m"
                      meta={branchMeta}
                      selected
                      actions={actions}
                    />
                    <FixtureBranchRow
                      title="Status derivation unit tests"
                      status="ready"
                      age="20m"
                      meta={branchMeta}
                      actions={actions}
                      actionsVisible
                    />
                  </BranchLane>
                  <BranchLane laneKey="fixture:errors" branch="fix/await-shell" count={3} rejected>
                    <FixtureBranchRow
                      title="Watch CI for PR #418"
                      status="monitoring"
                      age="27m"
                      meta={
                        <>
                          <StatusPill status="monitoring" />
                          {branchMeta}
                        </>
                      }
                      actions={actions}
                    />
                    <FixtureBranchRow
                      title="Resume after sleep crashes session"
                      status="error"
                      age="2h"
                      meta={
                        <>
                          <StatusPill status="error" />
                          {branchMeta}
                        </>
                      }
                      lastError="Provider exited with code 1: ECONNRESET while resuming"
                      actions={actions}
                    />
                    <FixtureBranchRow
                      title="Retry flaky e2e on CI"
                      status="error"
                      age="3h"
                      meta={
                        <>
                          <StatusPill status="error" />
                          {branchMeta}
                        </>
                      }
                      lastError={null}
                      actions={actions}
                    />
                  </BranchLane>
                  <BranchLane laneKey="fixture:none" branch={null} count={1} dragOver>
                    <FixtureBranchRow
                      title="Release checklist 0.9.4"
                      status="completed"
                      age="31m"
                      meta={
                        <>
                          <StatusPill status="completed" />
                          {branchMeta}
                        </>
                      }
                      actions={actions}
                    />
                  </BranchLane>
                </ul>
              </DndContext>
              {/* Separate context: the empty Pinned lane reuses the pinned droppable id. */}
              <DndContext>
                <ul aria-label="Fixture drop to pin">
                  <BranchLane laneKey="fixture:drop-to-pin" branch={null} count={0} pinned />
                </ul>
              </DndContext>
              <DndContext>
                <ul role="listbox" aria-label="Fixture compact threads" aria-multiselectable>
                  <BranchLane
                    laneKey="fixture:compact"
                    branch="feature/compact"
                    count={4}
                    density="compact"
                  >
                    {(
                      [
                        { title: "Compact at rest", status: "ready", age: "2h" },
                        {
                          title: "Compact selected",
                          status: "working",
                          age: "4:12",
                          selected: true,
                        },
                        {
                          title: "Compact with actions",
                          status: "input",
                          age: "9m",
                          actionsVisible: true,
                        },
                        {
                          title: "Compact error",
                          status: "error",
                          age: "1d",
                          lastError: "Provider exited",
                        },
                      ] as const
                    ).map((row) => (
                      <FixtureBranchRow
                        key={row.title}
                        {...row}
                        density="compact"
                        meta={branchMeta}
                        diffStat={<DiffStat additions={12} deletions={3} decorative />}
                        actions={actions}
                      />
                    ))}
                  </BranchLane>
                </ul>
              </DndContext>
              <div className="flex flex-col items-start gap-2">
                {(["Move", "Pin", "Settle", "Can't move here", "Sorted by status"] as const).map(
                  (verb) => (
                    <BranchDragChip
                      key={verb}
                      status="ready"
                      title="Session cookie rotation"
                      verb={verb}
                      rejected={verb === "Can't move here" || verb === "Sorted by status"}
                    />
                  ),
                )}
              </div>
            </Sample>
          </div>
          <div
            data-switchboard="settings"
            data-contrast-fixture
            className="min-w-0 overflow-hidden rounded-xl border border-sb-border bg-sb-surface text-sb-foreground"
          >
            <Sample name="ScopeChip · ChangedDot · ResetButton">
              <div className="flex flex-wrap items-center gap-3">
                <ScopeChip scope="global" />
                <ScopeChip scope="environment" name="MacBook" />
                <ScopeChip scope="project" name="e6code" override help="Overrides Global (off)" />
                <ChangedDot />
                <ResetButton onReset={reset} />
                <ResetButton onReset={reset} disabled />
              </div>
            </Sample>
            <section aria-label="SettingRow states">
              <h2 className="p-4 font-medium">SettingRow</h2>
              <SettingRow
                controlId="fixture-default"
                label="Default model"
                help="Used for new threads"
                scope={<ScopeChip scope="global" />}
              >
                <select id="fixture-default" className={inputClass}>
                  <option>Automatic</option>
                  <option>Codex</option>
                </select>
              </SettingRow>
              <SettingRow
                controlId="fixture-args"
                label="Extra arguments"
                help="A text field with pending edits"
                changed={value !== ""}
                onReset={reset}
                scope={
                  <ScopeChip
                    scope="project"
                    name="e6code"
                    override
                    help="Overrides Global (empty)"
                  />
                }
              >
                <input
                  id="fixture-args"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setDirty(true);
                  }}
                  className={inputClass}
                />
              </SettingRow>
              <SettingRow controlId="fixture-saved" label="Saved" saved>
                <input id="fixture-saved" className={inputClass} defaultValue="Saved value" />
              </SettingRow>
              <SettingRow controlId="fixture-saving" label="Saving" saving>
                <input id="fixture-saving" className={inputClass} defaultValue="Pending value" />
              </SettingRow>
              <SettingRow
                controlId="fixture-error"
                label="Error"
                error="Device unavailable"
                onRetry={() => setMessage("Retry requested")}
              >
                <input id="fixture-error" className={inputClass} defaultValue="Unreachable host" />
              </SettingRow>
              <SettingRow
                controlId="fixture-warning"
                label="Warning"
                warning="Font is not installed"
              >
                <input
                  id="fixture-warning"
                  className={inputClass}
                  defaultValue="Unavailable font"
                />
              </SettingRow>
              <SettingRow
                controlId="fixture-disabled"
                label="Disabled by scope"
                disabled
                disabledReason="Choose a connected environment"
              >
                <input id="fixture-disabled" className={inputClass} defaultValue="Read only" />
              </SettingRow>
              <SettingRow controlId="fixture-legacy" label="Legacy" legacy>
                <input
                  id="fixture-legacy"
                  className={inputClass}
                  defaultValue="Supported legacy value"
                />
              </SettingRow>
            </section>
            <Sample name="UnsavedBar">
              <UnsavedBar
                className="static"
                dirty={dirty}
                onDiscard={reset}
                onApply={() => {
                  setDirty(false);
                  setMessage("Changes applied");
                }}
                shortcut={<KbdHint>⌘ ↵</KbdHint>}
              />
              <UnsavedBar className="static" busy onDiscard={reset} onApply={reset} />
              <UnsavedBar
                className="static"
                error="Couldn't save. Try again."
                onDiscard={reset}
                onApply={() => setMessage("Apply retry requested")}
              />
              <UnsavedBar dirty={false} onDiscard={reset} onApply={reset} />
            </Sample>
            <Sample name="AttentionItem">
              <ul>
                {(["muted", "warning", "error", "success"] as const).map((tone) => (
                  <AttentionItem
                    key={tone}
                    icon={<ShieldQuestion />}
                    title={`${tone}: provider attention`}
                    detail="A connected environment needs attention"
                    actionLabel={`Open ${tone}`}
                    tone={tone}
                    onAction={() => setMessage(`${tone} attention opened`)}
                  />
                ))}
                <AttentionItem
                  icon={<ShieldQuestion />}
                  title="Device unavailable"
                  actionLabel="Unavailable"
                  disabled
                  onAction={() => setMessage("Unexpected disabled action")}
                />
              </ul>
            </Sample>
          </div>
        </div>
      </main>
    </TooltipProvider>
  );
}
