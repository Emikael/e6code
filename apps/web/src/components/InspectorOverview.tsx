/**
 * Run details: the thread's right panel at rest. It shows whenever the panel is
 * open and no other surface is active. Top to bottom it answers four questions:
 * what is it doing (Plan), what changed (Changes), who else is working
 * (Subagents), and what is it using (Usage). Each section collapses, and the
 * choice is remembered on this device.
 *
 * Only what providers report is shown: totals, never an invented breakdown.
 *
 * Visualization rules (carried over from the Agents surface it replaces):
 * - Spawn order is stable. Activity and completion update rows in place;
 *   finished rows fold only when the panel opens, never under the pointer.
 * - Status is a glyph plus a word, never color alone.
 * - Stop ends one live subagent, not the turn. It shows its pending state on
 *   the control until the provider confirms, and a failure arrives as a toast.
 * - Elapsed timers tick by DOM writes; nothing repaints continuously.
 * - Line counts are neutral; hue is kept for status.
 * - The panel sits on the sidebar ground, so metadata uses the sidebar's
 *   muted role, which every theme tunes for that ground. Cards are raised.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectScript,
  ScopedThreadRef,
  ThreadId,
  ThreadUsageTotal,
  TurnId,
  UsageLimitsReport,
  VcsWorkingTreeFile,
} from "@e6tools/contracts";
import { scopedThreadKey } from "@e6tools/client-runtime/environment";
import { mostConstrainedLimit } from "@e6tools/shared/usageLimits";
import { formatDuration } from "@e6tools/shared/orchestrationTiming";
import { describeThreadUsage } from "@e6tools/client-runtime/work-log/turn-usage";
import {
  type AgentPanelModel,
  type AgentPanelWorkflowGroup,
  formatSubagentFileCount,
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  type RuntimeSubagent,
  type SubagentChangedFiles,
  SUBAGENT_FILES_PREVIEW_LIMIT,
  SUBAGENT_STATUS_LABEL,
  subagentActivityText,
  subagentTone,
  summarizeSubagentStatuses,
} from "@e6tools/client-runtime/state/subagentRuntime";
import { describeSubagentUserRequest } from "@e6tools/client-runtime/pending-requests";
import {
  type ContextWindowSnapshot,
  describeContextWindowUsage,
  formatContextWindowTokens,
} from "@e6tools/client-runtime/work-log/context-window";
import { fileBasename, workspaceRelativeFilePath } from "@e6tools/client-runtime/markdown-links";
import {
  BracesIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleStopIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMinute } from "~/hooks/useNowMinute";
import { attachedCountNoun, unsentCodeCommentCount } from "~/lib/attachedForAgent";
import { useComposerDraftStore } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { type DiffPanelFocusTarget } from "~/diffPanelStore";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import {
  diffReviewFingerprint,
  reviewedCountLabel,
  useThreadDiffReviewStatuses,
} from "~/diffReviewStore";
import { useSubagentSelectionStore } from "~/subagentSelectionStore";
import { type RunDetailsSectionId, useUiStateStore } from "~/uiStateStore";
import type { ActivePlanState } from "~/session-logic";
import { DiffStat } from "./DiffStat";
import { DiffReviewTick } from "./diffs/DiffReviewTick";
import {
  isRunDetailsSectionOpen,
  planLimitReading,
  planLimitUsedPercent,
  planPositionLabel,
  planStepWords,
  pushCommitsLabel,
  RUN_DETAILS_CHANGES_PREVIEW_LIMIT,
} from "./runDetails.logic";
import {
  SUBAGENT_TONE_TEXT_CLASS,
  SubagentElapsed,
  SubagentStatusGlyph,
} from "./subagents/SubagentParts";
import { GitDefaultBranchDialog, useGitActionRunner } from "./useGitActionRunner";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "./ui/menu";
import { ScrollArea } from "./ui/scroll-area";
import { toastManager } from "./ui/toast";

/**
 * What Run details needs from the thread's workspace. Branch, pull request and editor actions
 * live in the thread header; Changes keeps only Review, Commit and Push.
 */
export interface InspectorWorkspace {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  gitCwd: string | null;
  /**
   * The project's setup script, when the thread runs in a worktree. `changed`
   * means the worktree was set up with an older version of it.
   */
  worktreeSetup: { readonly script: ProjectScript; readonly changed: boolean } | null;
  onRunProjectScript: (script: ProjectScript) => void;
  /** Opens the Diff surface; null when the thread has no diff to show. */
  onOpenDiff: (() => void) | null;
  /** Opens Diff on the working tree at one file or at its commit box; null with no diff. */
  onFocusDiff: ((target: DiffPanelFocusTarget) => void) | null;
  /** Opens one turn's diff, optionally at a file; null when there is none to show. */
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
}

/** Stopping one subagent; null when the thread offers no Stop at all. */
export interface InspectorSubagentStop {
  /** Live, on a provider that can stop one subagent, and not a workflow member. */
  readonly canStop: (agent: RuntimeSubagent) => boolean;
  readonly isPending: (agentId: string) => boolean;
  readonly stop: (agentId: string) => void;
  readonly shortcutLabel: string | null;
}

const MUTED = "text-sidebar-muted-foreground";
/** The raised card each section's body sits on. */
const CARD_CLASS_NAME = "rounded-xl border border-border bg-surface-raised";
/** Section metadata: mono, tabular, muted, on the heading's right. */
const META_CLASS_NAME = cn("min-w-0 truncate font-mono text-[11px] tabular-nums", MUTED);
/** A neutral bar with a visible edge, so an empty track still reads as a track. */
const METER_TRACK_CLASS_NAME =
  "h-1.5 overflow-hidden rounded-full bg-surface-well ring-1 ring-inset ring-sidebar-muted-foreground";

/** A section's open state: the user's choice on this device, else the section's default. */
function useRunDetailsSection(section: Exclude<RunDetailsSectionId, "subagents">) {
  const stored = useUiStateStore((state) => state.runDetailsSectionOpen[section]);
  const setOpen = useUiStateStore((state) => state.setRunDetailsSectionOpen);
  const open = isRunDetailsSectionOpen(section, stored);
  const toggle = useCallback(() => setOpen(section, !open), [open, section, setOpen]);
  return [open, toggle] as const;
}

// Live subagent work before the read model names its turn still counts as one turn.
const LIVE_WITHOUT_TURN = "live";
// The turn in which the user closed Subagents, per thread, so it stays closed for the rest of
// that turn across remounts. Not persisted: a turn does not outlive the session that shows it.
const subagentsClosedInTurnByThreadKey = new Map<string, string>();

/**
 * Subagents' open state: it opens when a subagent starts working in a turn and stays closed for
 * the rest of a turn the user closed it in. Opening for live work is stored, so the results stay
 * in view when the work ends; outside live work the stored choice applies.
 */
function useSubagentsSection(threadKey: string | null, liveTurnId: string | null) {
  const stored = useUiStateStore((state) => state.runDetailsSectionOpen.subagents);
  const setOpen = useUiStateStore((state) => state.setRunDetailsSectionOpen);
  const [closedInTurnId, setClosedInTurnId] = useState(() =>
    threadKey ? (subagentsClosedInTurnByThreadKey.get(threadKey) ?? null) : null,
  );
  const open = isRunDetailsSectionOpen("subagents", stored, { liveTurnId, closedInTurnId });
  useEffect(() => {
    if (liveTurnId !== null && open && stored !== true) setOpen("subagents", true);
  }, [liveTurnId, open, setOpen, stored]);
  const toggle = useCallback(() => {
    const closedIn = open ? liveTurnId : null;
    if (threadKey) {
      if (closedIn) subagentsClosedInTurnByThreadKey.set(threadKey, closedIn);
      else subagentsClosedInTurnByThreadKey.delete(threadKey);
    }
    setClosedInTurnId(closedIn);
    setOpen("subagents", !open);
  }, [liveTurnId, open, setOpen, threadKey]);
  return [open, toggle] as const;
}

/**
 * A collapsible Run details section: a heading that contains the toggle, optional content beside
 * the title, mono meta on the right, then the body while open. The meta stays visible when closed.
 */
function DetailsSection({
  title,
  open,
  onToggle,
  beside,
  meta,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  beside?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const headingId = useId();
  const bodyId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <h2 id={headingId} className="flex shrink-0 text-sm leading-5 font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={onToggle}
            className="inline-flex min-h-6 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            <ChevronDownIcon
              aria-hidden
              className={cn("size-3.5 shrink-0", MUTED, !open && "-rotate-90")}
            />
            {title}
          </button>
        </h2>
        {beside}
        {meta !== undefined && meta !== null ? (
          <span className={cn("ms-auto", META_CLASS_NAME)}>{meta}</span>
        ) : null}
      </div>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-2">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** The plan's steps as segments: done, running, and hollow for what is left. */
function PlanStepsMeter({ steps }: { steps: ActivePlanState["steps"] }) {
  return (
    <span aria-hidden className="flex shrink-0 gap-[3px]">
      {steps.map((step, index) => (
        <span
          // Segments never reorder; the index is the step's position.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={cn(
            "h-1.5 w-3.5 rounded-full",
            step.status === "completed"
              ? "bg-success"
              : step.status === "inProgress"
                ? "bg-primary"
                : "ring-1 ring-inset ring-sidebar-muted-foreground",
          )}
        />
      ))}
    </span>
  );
}

/** The agent's latest task list: each step says whether it is done, running, next or to do. */
function PlanSection({ plan }: { plan: ActivePlanState }) {
  const [open, toggle] = useRunDetailsSection("plan");
  const words = planStepWords(plan.steps);
  // Step text can repeat; numbering repeats keeps keys unique and stable within one plan.
  const seen = new Map<string, number>();
  const keys = plan.steps.map((step) => {
    const count = seen.get(step.step) ?? 0;
    seen.set(step.step, count + 1);
    return `${step.step}#${count}`;
  });
  return (
    <DetailsSection
      title="Plan"
      open={open}
      onToggle={toggle}
      beside={<PlanStepsMeter steps={plan.steps} />}
      meta={planPositionLabel(plan.steps)}
    >
      <ol className={cn(CARD_CLASS_NAME, "flex flex-col px-3 py-1")}>
        {plan.steps.map((step, index) => (
          <li
            key={keys[index]}
            aria-current={step.status === "inProgress" ? "step" : undefined}
            className="flex min-h-[34px] min-w-0 items-center gap-2.5"
          >
            {step.status === "completed" ? (
              <CheckIcon aria-hidden className="size-4 shrink-0 text-success-foreground" />
            ) : step.status === "inProgress" ? (
              <span
                aria-hidden
                className="mx-1 size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_var(--color-primary-surface)]"
              />
            ) : (
              <span
                aria-hidden
                className="mx-1 size-2 shrink-0 rounded-full border-[1.5px] border-sidebar-muted-foreground"
              />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm leading-[22px]",
                step.status === "completed" && MUTED,
                step.status === "inProgress" && "font-medium",
              )}
            >
              {step.step}
            </span>
            <span
              className={cn(
                "shrink-0 text-xs",
                step.status === "inProgress" ? "font-medium text-primary-text" : MUTED,
              )}
            >
              {words[index]}
            </span>
          </li>
        ))}
      </ol>
    </DetailsSection>
  );
}

const EMPTY_WORKING_TREE_FILES: ReadonlyArray<VcsWorkingTreeFile> = [];

/**
 * The working tree: its files, then Review changes (Diff), Commit (Diff at its commit box) and
 * Push. Space is reserved while status loads; hidden outside Git repositories.
 */
function ChangesSection({
  workspace,
  gitCwd,
  reviewShortcutLabel,
}: {
  workspace: InspectorWorkspace;
  gitCwd: string;
  reviewShortcutLabel: string | null;
}) {
  const [open, toggle] = useRunDetailsSection("changes");
  const [showAll, setShowAll] = useState(false);
  const { data: status } = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: workspace.environmentId, input: { cwd: gitCwd } }),
  );
  const threadRef = useMemo<ScopedThreadRef>(
    () => ({ environmentId: workspace.environmentId, threadId: workspace.threadId }),
    [workspace.environmentId, workspace.threadId],
  );
  const gitActions = useGitActionRunner({
    gitCwd,
    activeThreadRef: threadRef,
    gitStatus: status ?? null,
  });
  const files = status?.workingTree.files ?? EMPTY_WORKING_TREE_FILES;
  // Marks made in any Diff scope, matched by each file's counts.
  const reviewFiles = useMemo(
    () =>
      files.map((file) => ({
        path: file.path,
        fingerprint: diffReviewFingerprint({
          fileDiff: null,
          additions: file.insertions,
          deletions: file.deletions,
          ignoreWhitespace: false,
        }),
      })),
    [files],
  );
  const review = useThreadDiffReviewStatuses({
    threadKey: scopedThreadKey(threadRef),
    files: reviewFiles,
  });
  // Diff and file comments attached to the composer and not sent yet.
  const unsentComments = useComposerDraftStore((store) =>
    unsentCodeCommentCount(store.getComposerDraft(threadRef)?.reviewComments ?? []),
  );
  if (status && !status.isRepo) return null;

  const ahead = status?.aheadCount ?? 0;
  const behind = status?.behindCount ?? 0;
  const visibleFiles = showAll ? files : files.slice(0, RUN_DETAILS_CHANGES_PREVIEW_LIMIT);
  const canReach = (status?.hasUpstream ?? false) || (status?.hasPrimaryRemote ?? false);
  const pushDisabled = gitActions.isRunning || behind > 0 || status?.refName === null || !canReach;
  const { onOpenDiff, onFocusDiff } = workspace;

  return (
    <DetailsSection
      title="Changes"
      open={open}
      onToggle={toggle}
      meta={
        status && files.length > 0 ? (
          <>
            <DiffStat
              tone="neutral"
              additions={status.workingTree.insertions}
              deletions={status.workingTree.deletions}
            />
            {` · ${reviewedCountLabel(review.viewedCount, files.length)}`}
          </>
        ) : null
      }
    >
      {!status ? (
        <div aria-busy className={cn(CARD_CLASS_NAME, "h-[76px]")}>
          <span className="sr-only">Loading changes</span>
        </div>
      ) : files.length > 0 ? (
        <div className={cn(CARD_CLASS_NAME, "flex flex-col p-1")}>
          <ul className="flex flex-col">
            {visibleFiles.map((file) => {
              const reviewStatus = review.statusOf(file.path);
              const content = (
                <>
                  <DiffReviewTick status={reviewStatus} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left font-mono text-xs",
                      reviewStatus === "reviewed" && MUTED,
                    )}
                  >
                    {file.path}
                  </span>
                  <DiffStat
                    tone="neutral"
                    additions={file.insertions}
                    deletions={file.deletions}
                    className={cn("shrink-0 text-[11px]", MUTED)}
                  />
                </>
              );
              return (
                <li key={file.path}>
                  {onFocusDiff ? (
                    <button
                      type="button"
                      aria-label={`Open diff of ${file.path}, ${reviewStatus === "reviewed" ? "reviewed" : reviewStatus === "changed" ? "changed since review" : "not reviewed"}`}
                      onClick={() => onFocusDiff({ kind: "file", path: file.path })}
                      className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="flex min-h-8 min-w-0 items-center gap-2 px-2">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {files.length > RUN_DETAILS_CHANGES_PREVIEW_LIMIT ? (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
              className={cn(
                "flex min-h-8 w-full items-center rounded-md px-2 text-left text-xs outline-none transition-colors hover:bg-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
                MUTED,
              )}
            >
              {showAll ? "Show fewer" : `Show all ${files.length}`}
            </button>
          ) : null}
        </div>
      ) : (
        <p className={cn("text-xs", MUTED)}>No uncommitted changes</p>
      )}
      {unsentComments > 0 && onOpenDiff ? (
        <button
          type="button"
          onClick={onOpenDiff}
          className="self-start rounded-sm text-xs underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {`${attachedCountNoun(unsentComments, "comment")} not sent`}
        </button>
      ) : null}
      {status && (files.length > 0 || ahead > 0 || behind > 0) ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {onOpenDiff && files.length > 0 ? (
            <Button size="sm" variant="outline" onClick={onOpenDiff}>
              Review changes
              {reviewShortcutLabel ? <Kbd className="ms-0.5">{reviewShortcutLabel}</Kbd> : null}
            </Button>
          ) : null}
          {onFocusDiff && files.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => onFocusDiff({ kind: "commit" })}>
              Commit
            </Button>
          ) : null}
          {ahead > 0 && status.hasPrimaryRemote ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pushDisabled}
              title={behind > 0 ? "Pull first: the branch is behind its remote." : undefined}
              onClick={() => void gitActions.run({ action: "push" })}
            >
              {pushCommitsLabel(ahead)}
            </Button>
          ) : null}
          {behind > 0 ? <span className={cn("text-xs", MUTED)}>{behind} to pull</span> : null}
        </div>
      ) : null}
      <GitDefaultBranchDialog runner={gitActions} />
    </DetailsSection>
  );
}

/**
 * Shown only once the project's setup script changed since this worktree ran it. Running it
 * again records the current script on the thread, which clears the notice; a failed run leaves it.
 */
function WorktreeSetupNotice({ workspace }: { workspace: InspectorWorkspace }) {
  const setup = workspace.worktreeSetup;
  if (!setup?.changed) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[10px] bg-warning-surface px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 text-warning-foreground">
        Setup script changed since this worktree ran it
      </span>
      <Button
        size="xs"
        variant="outline"
        className="shrink-0"
        onClick={() => workspace.onRunProjectScript(setup.script)}
      >
        Run again
      </Button>
    </div>
  );
}

/** The thread provider's limits, as collected for /usage-limits. */
export interface InspectorPlanLimits {
  readonly report: UsageLimitsReport;
  readonly providerLabel: string;
}

/** A labelled neutral meter: the name, a mono reading, then the bar. */
function UsageMeter({
  label,
  reading,
  percent,
  accessibilityLabel,
  note,
}: {
  label: string;
  reading: string;
  percent: number | null;
  accessibilityLabel: string;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
        <span className={cn("shrink-0", META_CLASS_NAME)}>{reading}</span>
      </div>
      {percent !== null ? (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={accessibilityLabel}
          className={METER_TRACK_CLASS_NAME}
        >
          <div
            className="h-full rounded-full bg-sidebar-muted-foreground"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      {note}
    </div>
  );
}

/**
 * The provider limit the thread is closest to, written as the share used so the words and the
 * bar point the same way. Hidden when the provider reports no limits.
 */
function PlanLimitMeter({ planLimits }: { planLimits: InspectorPlanLimits }) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00.000Z`);
  const limit = useMemo(
    () => mostConstrainedLimit(planLimits.report, planLimits.providerLabel, now),
    [now, planLimits],
  );
  if (!limit) return null;
  const used = planLimitUsedPercent(limit.remainingPercent);
  // The card already belongs to this thread's provider, so the label is the window alone.
  const reading = planLimitReading(used, limit.resetsAt, now);
  return (
    <div className="border-t border-border pt-3">
      <UsageMeter
        label={limit.windowName}
        reading={reading}
        percent={used}
        accessibilityLabel={reading}
        note={limit.warning ? <p className="text-xs text-foreground">Close to the limit</p> : null}
      />
    </div>
  );
}

/**
 * What the thread is using, in one card: the context window, what the thread cost, how long the
 * latest turn ran, the model, and the nearest plan limit. The heading shows the context share
 * and never money.
 */
function UsageSection({
  contextWindow,
  usageTotal,
  latestTurnDurationMs,
  modelLabel,
  planLimits,
}: {
  contextWindow: ContextWindowSnapshot | null;
  usageTotal: ThreadUsageTotal | null;
  latestTurnDurationMs: number | null;
  modelLabel: string | null;
  planLimits: InspectorPlanLimits | null;
}) {
  const [open, toggle] = useRunDetailsSection("usage");
  const context = contextWindow ? describeContextWindowUsage(contextWindow) : null;
  const usage = describeThreadUsage(usageTotal ?? undefined);
  const facts: Array<{ term: string; value: ReactNode }> = [];
  if (usage) {
    facts.push({
      term: "This thread",
      value: (
        <>
          <span aria-hidden>{usage.cost ? `${usage.cost} · ${usage.tokens}` : usage.tokens}</span>
          <span className="sr-only">{usage.accessibilityLabel}</span>
        </>
      ),
    });
  }
  if (latestTurnDurationMs !== null) {
    facts.push({ term: "Latest turn", value: `ran ${formatDuration(latestTurnDurationMs)}` });
  }
  if (modelLabel) facts.push({ term: "Model", value: modelLabel });

  const contextReading = contextWindow
    ? contextWindow.maxTokens !== null &&
      contextWindow.maxTokens !== undefined &&
      contextWindow.maxTokens > 0
      ? `${formatContextWindowTokens(contextWindow.usedTokens)} of ${formatContextWindowTokens(contextWindow.maxTokens)}`
      : `${formatContextWindowTokens(contextWindow.usedTokens)} used`
    : null;

  return (
    <DetailsSection
      title="Usage"
      open={open}
      onToggle={toggle}
      meta={context?.percent !== null && context ? `Context ${context.percent}%` : null}
    >
      <div className={cn(CARD_CLASS_NAME, "flex flex-col gap-3 p-3")}>
        {context && contextReading ? (
          <UsageMeter
            label="Context"
            reading={contextReading}
            percent={context.percent}
            accessibilityLabel={context.label}
            note={
              context.warning || context.compactionNote ? (
                <p className={cn("text-xs", context.warning ? "text-foreground" : MUTED)}>
                  {[context.warning ? "Nearly full" : null, context.compactionNote]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null
            }
          />
        ) : null}
        {facts.length > 0 ? (
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 text-xs">
            {facts.map((fact) => (
              <div key={fact.term} className="contents">
                <dt>{fact.term}</dt>
                <dd className={cn("min-w-0 truncate text-right", META_CLASS_NAME)}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {planLimits ? <PlanLimitMeter planLimits={planLimits} /> : null}
      </div>
    </DetailsSection>
  );
}

/**
 * Read-only workflow script viewer, fetched through the contained
 * getWorkflowScript RPC (never a raw filesystem read from the client).
 */
function WorkflowScriptView({
  environmentId,
  threadId,
  scriptPath,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  scriptPath: string;
  onClose: () => void;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.workflowScript({ environmentId, input: { threadId, scriptPath } }),
  );
  return (
    <div className="rounded-lg border border-border bg-surface-well">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <BracesIcon aria-hidden className="size-3 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-muted-foreground">
          {scriptPath.split("/").at(-1)}
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onClose}
          aria-label="Close script"
          className="ml-auto"
        >
          <XIcon aria-hidden className="size-3" />
        </Button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {result._tag === "Success" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
            {result.value.contents}
            {result.value.truncated ? "\n… (truncated)" : ""}
          </pre>
        ) : result._tag === "Failure" ? (
          <p className="text-xs text-destructive-foreground">Could not load the script.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </div>
    </div>
  );
}

type LineagePhase = AgentPanelWorkflowGroup["phases"][number];

interface LineageNode {
  readonly agent: RuntimeSubagent;
  /** Workflow members by phase, in phase order; empty for a direct spawn. */
  readonly phases: ReadonlyArray<LineagePhase>;
  readonly unphased: ReadonlyArray<RuntimeSubagent>;
}

/** Top-level lineage in spawn order: workflows carry their members. */
function deriveLineage(model: AgentPanelModel): ReadonlyArray<LineageNode> {
  const nodes: LineageNode[] = [
    ...model.workflows.map((group) => ({
      agent: group.workflow,
      phases: group.phases,
      unphased: group.unphasedMembers,
    })),
    ...model.directAgents.map((agent) => ({ agent, phases: [], unphased: [] })),
  ];
  return nodes.sort(
    (a, b) =>
      a.agent.firstSeenAt.localeCompare(b.agent.firstSeenAt) ||
      a.agent.id.localeCompare(b.agent.id),
  );
}

function nodeMembers(node: LineageNode): ReadonlyArray<RuntimeSubagent> {
  return [...node.phases.flatMap((phase) => phase.members), ...node.unphased];
}

const PHASE_STATE_WORD: Readonly<Record<LineagePhase["state"], string>> = {
  pending: "Pending",
  running: "Working",
  done: "Done",
};

/**
 * One subagent in the lineage: its glyph, title, status word and elapsed time. Selecting it
 * opens its detail directly underneath. The More button holds the ways back out: the thread
 * card, the task text and the session, and Stop while it runs. Memoised: SubagentsSection
 * passes stable callbacks, so a row repaints only when its agent, state or stop control changes.
 */
const LineageRow = memo(function LineageRow({
  agent,
  expanded,
  selected,
  onSelect,
  onShowInThread,
  stopControl,
}: {
  agent: RuntimeSubagent;
  expanded: boolean;
  selected: boolean;
  onSelect: (agentId: string) => void;
  onShowInThread: ((agentId: string) => void) | null;
  stopControl: InspectorSubagentStop | null;
}) {
  const tone = subagentTone(agent);
  const canStop = stopControl?.canStop(agent) === true;
  const stopPending = canStop && stopControl.isPending(agent.id);
  const sessionUrl = agent.runHandles?.sessionUrl;
  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () =>
      toastManager.add({ type: "success", title: "Task copied", description: agent.title }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Couldn't copy the task",
        description: error.message,
      }),
  });
  return (
    // The More button stays in view so its actions are never reachable by hover alone.
    <div className="group/lineage flex min-h-9 min-w-0 items-center gap-1 ps-2 pe-1">
      <button
        type="button"
        data-lineage-row
        data-agent-id={agent.id}
        aria-expanded={expanded}
        onClick={() => onSelect(agent.id)}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SubagentStatusGlyph tone={tone} decorative />
        <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium">
          {agent.title}
        </span>
        <span className={cn("shrink-0 text-xs font-medium", SUBAGENT_TONE_TEXT_CLASS[tone])}>
          {SUBAGENT_STATUS_LABEL[tone]}
        </span>
        {/* Minutes, once a minute: the now bar is the one element on screen that ticks. */}
        <SubagentElapsed
          agent={agent}
          minutes
          className={cn("min-w-8 shrink-0 text-right font-mono text-[11px]", MUTED)}
        />
      </button>
      <Menu>
        <MenuTrigger
          aria-label={`More for ${agent.title}`}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent",
            MUTED,
          )}
        >
          <EllipsisIcon aria-hidden className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-44">
          {onShowInThread ? (
            <MenuItem onClick={() => onShowInThread(agent.id)}>
              <MessageSquareTextIcon aria-hidden />
              Show in thread
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => copyToClipboard(agent.title)}>
            <CopyIcon aria-hidden />
            Copy task
          </MenuItem>
          {sessionUrl ? (
            <MenuItem render={<a href={sessionUrl} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon aria-hidden />
              Open session
            </MenuItem>
          ) : null}
          {canStop ? (
            <>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={stopPending}
                onClick={() => stopControl.stop(agent.id)}
              >
                <CircleStopIcon aria-hidden />
                {stopPending ? "Stopping…" : "Stop subagent"}
                {/* The shortcut stops the selected subagent, so only its menu names it. */}
                {selected && stopControl.shortcutLabel && !stopPending ? (
                  <MenuShortcut className="ms-auto">{stopControl.shortcutLabel}</MenuShortcut>
                ) : null}
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </div>
  );
});

function moveLineageFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-lineage-row]"),
  );
  const index = rows.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  rows[
    Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))
  ]?.focus();
}

/**
 * The files a subagent's edits changed. Each opens the diff of the turn that
 * last touched it, at that file; counts appear only where the provider gave them.
 */
function SubagentFilesSection({
  changedFiles,
  workspaceRoot,
  onOpenTurnDiff,
}: {
  changedFiles: SubagentChangedFiles;
  workspaceRoot: string | null;
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const { files, additions, deletions } = changedFiles;
  const visible = showAll ? files : files.slice(0, SUBAGENT_FILES_PREVIEW_LIMIT);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-semibold">Files</span>
        <span>{formatSubagentFileCount(files.length)}</span>
        {additions !== null && deletions !== null ? (
          <DiffStat tone="neutral" additions={additions} deletions={deletions} />
        ) : null}
      </span>
      <ul className="-mx-1 flex flex-col">
        {visible.map((file) => {
          const path = workspaceRelativeFilePath(file.path, workspaceRoot) ?? file.path;
          const name = fileBasename(path);
          const directory = path.length > name.length ? path.slice(0, -name.length - 1) : "";
          const content = (
            <>
              {/* Name and folder both give way; only the counts keep their width. */}
              <span className="min-w-0 truncate font-mono text-[11px]">{name}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {directory}
              </span>
              {file.additions !== null && file.deletions !== null ? (
                <DiffStat
                  tone="neutral"
                  additions={file.additions}
                  deletions={file.deletions}
                  className="shrink-0 text-[11px]"
                />
              ) : null}
            </>
          );
          const turnId = file.turnId;
          return (
            <li key={file.path}>
              {onOpenTurnDiff && turnId ? (
                <button
                  type="button"
                  aria-label={`Open diff of ${path}`}
                  onClick={() => onOpenTurnDiff(turnId, path)}
                  className="flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <div className="flex h-6 min-w-0 items-center gap-2 px-1">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {files.length > SUBAGENT_FILES_PREVIEW_LIMIT ? (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="self-start rounded-md text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAll ? "Show fewer" : `Show ${files.length - SUBAGENT_FILES_PREVIEW_LIMIT} more`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A subagent's detail, under its row: what it is doing now (or its result), recent activity,
 * its numbers, the actions, and the files it changed.
 */
function SubagentDetail({
  agent,
  environmentId,
  threadId,
  workspaceRoot,
  onOpenTurnDiff,
  onShowInThread,
  stopControl,
}: {
  agent: RuntimeSubagent;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  workspaceRoot: string | null;
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
  onShowInThread: ((agentId: string) => void) | null;
  stopControl: InspectorSubagentStop | null;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const canStop = stopControl?.canStop(agent) === true;
  const stopPending = canStop && stopControl.isPending(agent.id);
  const live = isActiveSubagentStatus(agent.status);
  const modelLabel = formatSubagentModelLabel(agent.model, agent.effort);
  const role =
    agent.role && agent.role.trim().toLowerCase() !== agent.title.trim().toLowerCase()
      ? agent.role
      : null;
  const request = agent.waitingOn ? describeSubagentUserRequest(agent.waitingOn) : null;
  const activity = agent.waitingOn
    ? agent.waitingOn.kind === "approval"
      ? "Waiting for your approval in the composer."
      : "Waiting for your answer in the composer."
    : live
      ? (agent.progress ?? subagentActivityText(agent))
      : (agent.error ?? agent.result ?? subagentActivityText(agent));
  const scriptPath = agent.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  const sessionUrl = agent.runHandles?.sessionUrl;
  // "Recent" adds history, so it never repeats what "Now" already says.
  const recent = agent.recentActivity
    .filter((entry) => entry.summary !== activity)
    .slice(-4)
    .toReversed();
  const facts: Array<{ term: string; value: ReactNode }> = [
    ...(role ? [{ term: "Role", value: role }] : []),
    ...(modelLabel ? [{ term: "Model", value: modelLabel }] : []),
    {
      term: "Tokens",
      value: agent.usage ? formatSubagentTokenCount(agent.usage.totalTokens) : "–",
    },
    {
      term: "Tool calls",
      value:
        agent.activationCount > 1
          ? `${agent.usage?.toolUses ?? "–"} · run ${agent.activationCount}`
          : (agent.usage?.toolUses ?? "–"),
    },
    ...(agent.changedFiles
      ? [{ term: "Files changed", value: agent.changedFiles.files.length }]
      : []),
  ];

  return (
    <div
      role="group"
      aria-label={`${agent.title} details`}
      className="flex flex-col gap-2.5 px-3 pt-1 pb-3"
    >
      {activity ? (
        <p
          className={cn(
            "line-clamp-6 whitespace-pre-wrap break-words text-sm leading-[22px]",
            agent.status === "failed" && "text-destructive-foreground",
          )}
        >
          <span className={MUTED}>
            {live ? "Now" : agent.status === "failed" ? "Error" : "Result"}
          </span>
          {" · "}
          {request ? (
            <>
              {request.text}
              {request.code ? (
                <>
                  {" "}
                  <code className="break-all font-mono text-xs">{request.code}</code>
                </>
              ) : null}
              <span className={cn("block text-xs", MUTED)}>{activity}</span>
            </>
          ) : (
            activity
          )}
        </p>
      ) : null}
      {recent.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className={cn("text-xs font-semibold", MUTED)}>Recent</span>
          <ul className="flex flex-col gap-0.5">
            {recent.map((entry) => (
              <li key={`${entry.at}:${entry.summary}`} className={cn("truncate text-xs", MUTED)}>
                {entry.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 text-xs">
        {facts.map((fact) => (
          <div key={fact.term} className="contents">
            <dt className={MUTED}>{fact.term}</dt>
            <dd className="min-w-0 truncate text-right font-mono text-[11px] tabular-nums">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      {onShowInThread || canShowScript || sessionUrl || canStop ? (
        <div className="flex flex-wrap gap-2">
          {onShowInThread ? (
            <Button size="sm" variant="outline" onClick={() => onShowInThread(agent.id)}>
              Show in thread
            </Button>
          ) : null}
          {canStop ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={stopPending}
              title={
                stopControl.shortcutLabel
                  ? `Stop subagent (${stopControl.shortcutLabel})`
                  : "Stop subagent"
              }
              onClick={() => stopControl.stop(agent.id)}
            >
              {stopPending ? "Stopping…" : "Stop subagent"}
            </Button>
          ) : null}
          {canShowScript ? (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={scriptOpen}
              onClick={() => setScriptOpen((value) => !value)}
            >
              <BracesIcon aria-hidden />
              {scriptOpen ? "Hide script" : "Show script"}
            </Button>
          ) : null}
          {sessionUrl ? (
            <Button
              size="sm"
              variant="ghost"
              render={<a href={sessionUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden />
              Open session
            </Button>
          ) : null}
        </div>
      ) : null}
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {/* Files sit below the actions: the list grows while the subagent runs
          and would otherwise push Stop down under the pointer. */}
      {agent.changedFiles ? (
        <div className="border-t border-border pt-2.5">
          <SubagentFilesSection
            changedFiles={agent.changedFiles}
            workspaceRoot={workspaceRoot}
            onOpenTurnDiff={onOpenTurnDiff}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every subagent this thread spawned, in spawn order. Selecting a row opens its detail under
 * it; selecting it again closes it. The section opens by itself when a subagent starts working.
 */
function SubagentsSection({
  model,
  threadKey,
  latestTurnId,
  environmentId,
  threadId,
  workspaceRoot,
  onOpenTurnDiff,
  stopControl,
}: {
  model: AgentPanelModel;
  threadKey: string | null;
  latestTurnId: string | null;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  workspaceRoot: string | null;
  onOpenTurnDiff: ((turnId: TurnId, filePath?: string) => void) | null;
  stopControl: InspectorSubagentStop | null;
}) {
  const [open, toggle] = useSubagentsSection(
    threadKey,
    model.liveCount > 0 ? (latestTurnId ?? LIVE_WITHOUT_TURN) : null,
  );
  const [showFolded, setShowFolded] = useState(false);
  // The selected row's detail is open unless the user closed it; picking another row, or a
  // reveal from the thread, opens it again.
  const [closedDetail, setClosedDetail] = useState<{
    readonly agentId: string;
    readonly revealCount: number;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const storedSelection = useSubagentSelectionStore((state) =>
    threadKey ? (state.selectedByThreadKey[threadKey] ?? null) : null,
  );
  const revealCount = useSubagentSelectionStore((state) =>
    threadKey ? (state.revealByThreadKey[threadKey] ?? 0) : 0,
  );
  const select = useSubagentSelectionStore((state) => state.select);
  const showInThread = useSubagentSelectionStore((state) => state.showInThread);
  const lineage = useMemo(() => deriveLineage(model), [model]);
  const allAgents = useMemo(
    () => lineage.flatMap((node) => [node.agent, ...nodeMembers(node)]),
    [lineage],
  );
  const selected =
    allAgents.find((agent) => agent.id === storedSelection) ??
    allAgents.find((agent) => isActiveSubagentStatus(agent.status)) ??
    allAgents.at(-1) ??
    null;
  const selectedId = selected?.id ?? null;
  const detailClosed =
    closedDetail !== null &&
    closedDetail.agentId === selectedId &&
    closedDetail.revealCount === revealCount;
  const expandedId = detailClosed ? null : selectedId;
  const onSelect = useCallback(
    (agentId: string) => {
      if (!threadKey) return;
      if (agentId === selectedId) {
        setClosedDetail(detailClosed ? null : { agentId, revealCount });
        return;
      }
      select(threadKey, agentId);
    },
    [detailClosed, revealCount, select, selectedId, threadKey],
  );
  const onShowInThread = useCallback(
    (agentId: string) => {
      if (!threadKey) return;
      select(threadKey, agentId);
      showInThread(threadKey, agentId);
    },
    [select, showInThread, threadKey],
  );

  // Pin the default pick once shown, so the detail does not jump to another
  // agent when this one finishes and its result is what the user came for.
  useEffect(() => {
    if (threadKey && selectedId && storedSelection === null) select(threadKey, selectedId);
  }, [select, selectedId, storedSelection, threadKey]);

  // A pick from the thread opens the row's detail and scrolls it into view.
  useEffect(() => {
    if (revealCount === 0 || !selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-agent-id="${CSS.escape(selectedId)}"]`,
    );
    row?.parentElement?.parentElement?.scrollIntoView({ block: "nearest" });
  }, [revealCount, selectedId]);

  // Finished top-level rows fold only as the panel opens on live work; rows
  // that finish afterwards stay where they are.
  const [foldedIds] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        model.liveCount > 0
          ? lineage.filter((node) => node.agent.status === "completed").map((node) => node.agent.id)
          : [],
      ),
  );
  const folded = lineage.filter(
    (node) => foldedIds.has(node.agent.id) && node.agent.id !== selectedId,
  );
  const folding = folded.length >= 2;
  const visible =
    folding && !showFolded ? lineage.filter((node) => !folded.includes(node)) : lineage;

  // Coordinators with members are containers; their members carry the work.
  const counted = lineage.flatMap((node) => {
    const members = nodeMembers(node);
    return members.length > 0 ? members : [node.agent];
  });
  const summary = summarizeSubagentStatuses(counted);

  const renderRow = (agent: RuntimeSubagent) => {
    const expanded = agent.id === expandedId;
    const row = (
      <LineageRow
        agent={agent}
        expanded={expanded}
        selected={agent.id === selectedId}
        onSelect={onSelect}
        onShowInThread={threadKey ? onShowInThread : null}
        stopControl={stopControl}
      />
    );
    return (
      <div
        key={agent.id}
        className={cn(
          "flex flex-col rounded-lg",
          expanded && "bg-sidebar-row-selected ring-1 ring-inset ring-input",
        )}
      >
        {row}
        {expanded ? (
          <SubagentDetail
            agent={agent}
            environmentId={environmentId}
            threadId={threadId}
            workspaceRoot={workspaceRoot}
            onOpenTurnDiff={onOpenTurnDiff}
            onShowInThread={threadKey ? onShowInThread : null}
            stopControl={stopControl}
          />
        ) : null}
      </div>
    );
  };

  return (
    <DetailsSection title="Subagents" open={open} onToggle={toggle} meta={summary.text || null}>
      <div
        ref={listRef}
        role="group"
        aria-label="Subagents"
        onKeyDown={moveLineageFocus}
        className={cn(CARD_CLASS_NAME, "flex flex-col gap-0.5 p-1")}
      >
        {visible.map((node) => (
          <div key={node.agent.id} className="flex flex-col gap-0.5">
            {renderRow(node.agent)}
            {node.phases.length > 0 || node.unphased.length > 0 ? (
              <div className="ms-4 flex flex-col gap-0.5 border-s border-sidebar-border ps-2.5">
                {node.phases.map((phase) => (
                  <div key={phase.index} className="flex flex-col gap-0.5">
                    <div className={cn("flex h-6 items-center gap-1.5 px-2 text-xs", MUTED)}>
                      <span className="min-w-0 truncate font-medium">{phase.title}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{PHASE_STATE_WORD[phase.state]}</span>
                    </div>
                    {phase.members.map(renderRow)}
                  </div>
                ))}
                {node.unphased.map(renderRow)}
              </div>
            ) : null}
          </div>
        ))}
        {folding ? (
          <button
            type="button"
            aria-expanded={showFolded}
            onClick={() => setShowFolded((value) => !value)}
            className={cn(
              "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors hover:bg-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
              MUTED,
            )}
          >
            {showFolded ? (
              <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
            ) : (
              <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
            )}
            <span className="flex-1">
              {showFolded ? `Hide ${folded.length} done` : `${folded.length} done`}
            </span>
          </button>
        ) : null}
      </div>
    </DetailsSection>
  );
}

interface InspectorOverviewProps {
  model: AgentPanelModel;
  threadKey: string | null;
  workspace: InspectorWorkspace | null;
  subagentStop: InspectorSubagentStop | null;
  /** The agent's latest task list; null when it has not published one. */
  plan: ActivePlanState | null;
  /** Latest context window usage; null when the provider reports none. */
  contextWindow: ContextWindowSnapshot | null;
  /** Usage summed over every turn, from the thread shell; null when none was reported. */
  usageTotal: ThreadUsageTotal | null;
  /** The thread provider's limits; null when it reports none. */
  planLimits: InspectorPlanLimits | null;
  /** How long the latest turn ran, once it finished; the read model keeps no earlier timings. */
  latestTurnDurationMs: number | null;
  /** The thread's model, from `thread.modelSelection`, as the composer names it, with its effort. */
  modelLabel: string | null;
  /** The thread's latest turn, so Subagents can tell one turn's live work from the next. */
  latestTurnId: string | null;
  /** The Diff shortcut, shown on Review changes. */
  reviewShortcutLabel: string | null;
}

function InspectorOverviewView({
  model,
  threadKey,
  workspace,
  subagentStop,
  plan,
  contextWindow,
  usageTotal,
  planLimits,
  latestTurnDurationMs,
  modelLabel,
  latestTurnId,
  reviewShortcutLabel,
}: InspectorOverviewProps) {
  const gitCwd = workspace?.gitCwd ?? null;
  const hasUsage = describeThreadUsage(usageTotal ?? undefined) !== null;
  const showUsage =
    contextWindow !== null ||
    hasUsage ||
    planLimits !== null ||
    latestTurnDurationMs !== null ||
    modelLabel !== null;
  const empty =
    (plan === null || plan.steps.length === 0) &&
    contextWindow === null &&
    !hasUsage &&
    !model.hasAgents;
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-sidebar surface-grain text-[13px] leading-[18px] text-sidebar-foreground"
      data-inspector-overview
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-[22px] p-4">
          {plan && plan.steps.length > 0 ? <PlanSection plan={plan} /> : null}
          {workspace ? <WorktreeSetupNotice workspace={workspace} /> : null}
          {workspace && gitCwd ? (
            <ChangesSection
              workspace={workspace}
              gitCwd={gitCwd}
              reviewShortcutLabel={reviewShortcutLabel}
            />
          ) : null}
          {model.hasAgents ? (
            <SubagentsSection
              model={model}
              threadKey={threadKey}
              latestTurnId={latestTurnId}
              environmentId={workspace?.environmentId ?? null}
              threadId={workspace?.threadId ?? null}
              workspaceRoot={gitCwd}
              onOpenTurnDiff={workspace?.onOpenTurnDiff ?? null}
              stopControl={subagentStop}
            />
          ) : null}
          {showUsage ? (
            <UsageSection
              contextWindow={contextWindow}
              usageTotal={usageTotal}
              latestTurnDurationMs={latestTurnDurationMs}
              modelLabel={modelLabel}
              planLimits={planLimits}
            />
          ) : null}
          {empty ? (
            <p className={cn("text-xs", MUTED)}>
              The plan, context, cost and subagents appear here once the agent reports them.
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function shallowEqualWorkspace(
  left: InspectorWorkspace | null,
  right: InspectorWorkspace | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  const keys = Object.keys(left) as Array<keyof InspectorWorkspace>;
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
}

/** The plan is re-derived whenever activities change; compare the steps it shows. */
function samePlan(left: ActivePlanState | null, right: ActivePlanState | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.steps.length === right.steps.length &&
    left.steps.every(
      (step, index) =>
        step.step === right.steps[index]?.step && step.status === right.steps[index]?.status,
    )
  );
}

/** The snapshot is re-derived whenever activities change; compare what it shows. */
function sameContextWindow(
  left: ContextWindowSnapshot | null,
  right: ContextWindowSnapshot | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.updatedAt === right.updatedAt &&
    left.usedTokens === right.usedTokens &&
    left.maxTokens === right.maxTokens &&
    left.compactsAutomatically === right.compactsAutomatically &&
    left.autoCompactThreshold === right.autoCompactThreshold
  );
}

/** Every shell refetch decodes a fresh total; compare what it shows. */
function sameUsageTotal(left: ThreadUsageTotal | null, right: ThreadUsageTotal | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.totalTokens === right.totalTokens &&
    left.costUsd === right.costUsd &&
    left.costSource === right.costSource
  );
}

/**
 * Streaming deltas re-render ChatView; the derived props are compared by what
 * they show, and ChatView memoises the workspace on stable inputs, so the panel
 * and its controls stay still between deltas.
 */
export const InspectorOverview = memo(
  InspectorOverviewView,
  (previous, next) =>
    previous.model === next.model &&
    previous.threadKey === next.threadKey &&
    previous.subagentStop === next.subagentStop &&
    samePlan(previous.plan, next.plan) &&
    sameContextWindow(previous.contextWindow, next.contextWindow) &&
    sameUsageTotal(previous.usageTotal, next.usageTotal) &&
    previous.planLimits === next.planLimits &&
    previous.latestTurnDurationMs === next.latestTurnDurationMs &&
    previous.modelLabel === next.modelLabel &&
    previous.latestTurnId === next.latestTurnId &&
    previous.reviewShortcutLabel === next.reviewShortcutLabel &&
    shallowEqualWorkspace(previous.workspace, next.workspace),
);
