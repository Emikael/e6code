import { parseChangeRequestUrl } from "@e6tools/shared/changeRequestUrl";
import { useAtomValue } from "@effect/atom-react";
import { usePullRequestStack } from "~/state/usePullRequestStack";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopedThreadKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@e6tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  DEFAULT_SERVER_SETTINGS,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type PullRequestAction,
  type PullRequestMergeMethod,
  type PullRequestListEntry,
  type PullRequestUpdateMethod,
  type PullRequestRef,
  resolveEnvironmentMachineKind,
  type ScopedThreadRef,
} from "@e6tools/contracts";
import { resolveProjectSettings } from "@e6tools/shared/projectSettings";
import {
  ArrowDownUpIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  CopyIcon,
  ChevronDownIcon,
  FileSearchIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  HammerIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  PlayIcon,
  RotateCcwIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleIcon,
  Clock3Icon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useComposerHasText } from "~/hooks/useComposerHasText";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  type ShortcutMatchContext,
} from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useClientSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { changeRequestRepositoryUrl, gitHubPullRequestBrowserUrl } from "~/lib/openPullRequestLink";
import { usePreparePullRequestThreadAction } from "~/lib/sourceControlActions";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { buildPhysicalToLogicalProjectKeyMap } from "~/sidebarProjectGrouping";
import { useProjects, useServerConfigs, useThread } from "~/state/entities";
import { useOpenLink } from "~/browser/useOpenLink";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import {
  pullRequestEnvironment,
  pullRequestListEntryToSummary,
  newestPullRequestSummary,
  usePullRequestTurnRefresh,
  useSharedPullRequestSummary,
} from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { PullRequestStackMenu } from "./PullRequestStackMenu";
import { PullRequestThreadLinks } from "./PullRequestThreadLinks";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { PullRequestEditButton } from "./PullRequestEditButton";
import { Input } from "../ui/input";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import { PullRequestDetailGhost, PullRequestTimelineGhost } from "./PullRequestGhosts";
import { PullRequestCopyableCode } from "./PullRequestCopyableCode";
import { PullRequestActivityUnavailableState } from "./PullRequestActivityUnavailableState";
import { DiffPanelLoadingState } from "../DiffPanelShell";
import { PanelErrorCard } from "../panel/PanelErrorCard";
import { panelFillHolder } from "../panel/panelFill";
import type {
  PullRequestAgentSelectionInput,
  PullRequestCodeFillInputs,
} from "./PullRequestCodeTab";
import { openOnHostLabel, showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";
import { PullRequestMarkdownContext } from "./PullRequestMarkdown";
import { PullRequestCommentComposer } from "./PullRequestCommentComposer";
import { PullRequestSummaryTab } from "./PullRequestSummaryTab";
import { PullRequestNextStepCard } from "./PullRequestNextStepCard";
import { usePendingReviewComments } from "./pullRequestReviewStore";
import { PullRequestReviewerPicker } from "./PullRequestReviewerPicker";
import { PullRequestTimelineTab } from "./PullRequestTimelineTab";
import {
  buildAddSelectionToAgentHandoff,
  buildAskAboutPullRequestHandoff,
  buildExplainPullRequestHandoff,
  buildFixFindingHandoff,
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  buildReviewPullRequestHandoff,
  handoffPrompt,
  handoffReviewComments,
  latestPullRequestReviewOutcomes,
  loadingPullRequestCheckoutCommand,
  isStackedPullRequestBase,
  pullRequestActionMenuHasGroup,
  pullRequestActionNeedsHostRefresh,
  pullRequestCheckoutCommand,
  pullRequestFindingKey,
  pullRequestHandoffLabels,
  PULL_REQUEST_MERGE_METHOD_LABELS,
  readableFailure,
  readPullRequestDetailSnapshot,
  resolvePullRequestReferenceHost,
  resolveDisplayedPullRequestDetail,
  allowsSinglePullRequestMerge,
  resolveBaseFreshness,
  resolveMergeReadiness,
  hostMergeBlockReason,
  mergeReadinessCountLabel,
  resolvePullRequestMergeMethod,
  resolvePullRequestNextStep,
  pullRequestOwnReviewLine,
  pullRequestCodeTabLabel,
  pullRequestHostName,
  type MergeReadiness,
  type MergeReadinessStatus,
  type PullRequestNextStepActionKind,
  type PullRequestFinding,
  shouldRefreshPullRequestActivity,
  stripPullRequestHandoffReferences,
  writePullRequestDetailSnapshot,
} from "./pullRequestDetail.logic";
import { canEditPullRequestChangeRequest } from "./pullRequestEditing.logic";
import {
  resolvePickableEnvironments,
  type PickableEnvironment,
} from "./pullRequestProjectAssignment.logic";
import {
  PullRequestMetaLine,
  PullRequestReviewOutcomeIcon,
  pullRequestChecksState,
  pullRequestReviewOutcomeToneClassName,
  resolvePullRequestState,
} from "./pullRequestPresentation";
import { PullRequestGlyph } from "./pullRequestIcons";
import { useMomentCount } from "../../hooks/useMomentCount";
import { SettlingGlyph } from "../SettlingGlyph";
import { usePullRequestMergeCommandStore } from "./pullRequestMergeCommand";
import { isEditableFocused } from "~/lib/editableFocus";
import { destructiveApprovalPendingIn } from "../chat/holdToConfirm";

type DetailTab = "summary" | "timeline" | "code";

const ACTION_SUCCESS_LABELS: Record<PullRequestAction, string> = {
  merge: "Pull request merged",
  ready: "Marked ready for review",
  draft: "Converted to draft",
  close: "Pull request closed",
  reopen: "Pull request reopened",
  "update-branch": "Branch updated with the base branch",
  // True whichever it did: a pull request that was already mergeable merges the moment this is
  // armed, and the client has no way to tell that apart from one still waiting on something.
  "enable-auto-merge":
    "Merge when ready is on — merges as soon as this is ready, sooner if it already is",
  "disable-auto-merge": "Merge when ready is off",
  revert: "Revert pull request opened",
  "approve-workflows": "Workflows approved",
};

/** Said as the thing that did not happen, rather than as the operation that returned an error. */
const ACTION_FAILURE_LABELS: Record<PullRequestAction, string> = {
  merge: "Could not merge this pull request",
  ready: "Could not mark this ready for review",
  draft: "Could not convert this to a draft",
  close: "Could not close this pull request",
  reopen: "Could not reopen this pull request",
  "update-branch": "Could not update this branch",
  "enable-auto-merge": "Could not turn on Merge when ready",
  "disable-auto-merge": "Could not cancel Merge when ready",
  revert: "Could not open a revert pull request",
  "approve-workflows": "Could not approve workflows",
};

/** What to try, for the times the host says only that it refused. */
const ACTION_FAILURE_HINTS: Record<PullRequestAction, string> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  draft: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen:
    "The host refused it. Check that you have write access, and that the branch still exists.",
  // Said for the merge commit, which is what an update is unless a rebase was asked for. The
  // rebase has its own reasons to fail and its own sentence below.
  "update-branch":
    "The host refused it. Check that you have write access to the branch — one from a fork also needs its author to allow edits from maintainers — and that it does not conflict with the base.",
  // The one refusal that is usually a repository setting rather than anything about this branch:
  // GitHub will not arm an auto-merge at all unless the repository has the feature switched on.
  "enable-auto-merge":
    "The host refused it. Check that this repository allows auto-merge, that you have write access, and that there is something left for it to wait on.",
  "disable-auto-merge":
    "The host refused it. Check that you have write access, and that the merge has not already happened.",
  revert:
    "The host refused it. Check that you have write access and that this pull request was merged on the host.",
  "approve-workflows":
    "The host refused it. Check that you have Actions write access and that these workflow runs are still awaiting approval.",
};

/**
 * Said instead of the update hint when the reader asked for a rebase: it is the one that fails on
 * its own merits, because GitHub replays the commits and stops at the first that does not apply.
 * Offering the merge commit only makes sense to somebody who did not already choose it.
 */
const UPDATE_BRANCH_REBASE_FAILURE_HINT =
  "The host refused it. A rebase stops at the first commit that does not apply cleanly; updating with a merge commit may still work.";

const TABS: ReadonlyArray<{ value: DetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

// The diff viewer pulls in its worker pool, so load it only when the reader approaches Code.
// Start the download on tab hover or focus, before the click, without loading it for every PR.
const loadCodeTab = () => import("./PullRequestCodeTab");
const PullRequestCodeTab = lazy(loadCodeTab);

/**
 * What the last hand-off wrote into each draft, kept outside React because the panel that wrote it
 * is closed by the time the next one opens. It is how a prompt the reader has since edited is told
 * apart from the one they were handed: only the sentence still exactly as written may be replaced.
 */
const lastHandoffPromptByDraft = new Map<string, string>();

const composerTargetKey = (target: ScopedThreadRef | DraftId): string =>
  typeof target === "string" ? target : scopedThreadKey(target);

/**
 * Which server the checkout and the hand-offs land on, where more than one of them holds this
 * repository. The list picked one of them to show the pull request under, so that everything on
 * it is read from somewhere; where the reader wants to work is a separate answer, and this is
 * where they give it.
 */
function ActOnEnvironmentPicker({
  environments,
  value,
  onChange,
  disabled,
}: {
  environments: ReadonlyArray<PickableEnvironment>;
  value: EnvironmentId;
  onChange: (environmentId: EnvironmentId) => void;
  disabled: boolean;
}) {
  return (
    <>
      <MenuSeparator />
      <MenuRadioGroup
        value={value}
        onValueChange={(environmentId) => onChange(environmentId as EnvironmentId)}
      >
        {environments.map((environment) => (
          <MenuRadioItem
            key={environment.environmentId}
            value={environment.environmentId}
            disabled={disabled}
          >
            {/* The radio item lays its children out as one block, so the icon and the label
                need their own row to share a line. */}
            <span className="flex min-w-0 items-center gap-2">
              <EnvironmentMachineIcon
                kind={environment.machine ?? "server"}
                className="size-3.5 shrink-0"
              />
              <span className="truncate">{environment.label}</span>
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </>
  );
}

/** The number is a link in every place the host writes it, so the right-click that copies one
    has to answer here too — otherwise the platform's own cut/paste menu opens over it. */
const openNumberContextMenu = (
  event: ReactMouseEvent,
  detail: { readonly url: string; readonly provider: string },
): void => {
  event.preventDefault();
  event.stopPropagation();
  void showPullRequestLinkContextMenu({
    url: detail.url,
    openLabel: openOnHostLabel(detail.provider),
    position: { x: event.clientX, y: event.clientY },
  });
};

/**
 * The stale-branch warning, said beside the branch it is about rather than as a bar of its own.
 * The banner this replaces held a row of chrome open across the top of every pull request that
 * had fallen behind, pushing the reading down to say something that is true of the base branch
 * and nothing else; as a mark on the base branch it is where a reader would look for it, and the
 * sentence and the way out of it arrive together the moment the mark is pointed at.
 *
 * A popover rather than a tooltip because what it holds can be pressed: a tooltip's layer takes
 * no pointer, and a control nobody can reach is worse than no control.
 */
function PullRequestBaseFreshnessWarning({
  baseBranch,
  freshness,
  pending,
  onUpdate,
  iconClassName,
  className,
  children,
}: {
  readonly baseBranch: string;
  readonly freshness: {
    readonly behindBy: number | null;
    readonly methods: ReadonlyArray<PullRequestUpdateMethod>;
  };
  readonly pending: boolean;
  readonly onUpdate: (method: PullRequestUpdateMethod) => void;
  readonly iconClassName?: string;
  readonly className?: string;
  /** What the warning is about, drawn in the same amber before the mark: the base branch. */
  readonly children?: ReactNode;
}) {
  const behind =
    freshness.behindBy === null
      ? ""
      : ` by ${freshness.behindBy.toLocaleString()} ${
          freshness.behindBy === 1 ? "commit" : "commits"
        }`;
  const summary = `This branch is out-of-date with ${baseBranch}${behind}.`;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={120}
        render={
          <button
            type="button"
            aria-label={summary}
            className={cn(
              "inline-flex min-w-0 shrink-0 cursor-help items-center gap-1 rounded-sm text-warning-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        {children}
        <TriangleAlertIcon aria-hidden className={cn("size-3.5 shrink-0", iconClassName)} />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="bottom"
        className="max-w-80"
        viewportClassName="py-2.5 [--viewport-inline-padding:--spacing(3)]"
      >
        <p className="text-xs text-foreground">{summary}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Changes can be cleanly merged.</p>
        {/* Each way the host offers and this reader may take, as its own button: a split button
            would need a menu inside a popover, and two buttons say the same thing in one layer. */}
        {freshness.methods.length > 0 ? (
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {freshness.methods.map((method) => (
              <Button
                key={method}
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => onUpdate(method)}
              >
                <PullRequestGlyph.merged aria-hidden className="size-3" />
                {method === "rebase" ? "Update with rebase" : "Update branch"}
              </Button>
            ))}
          </span>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

const READINESS_STATUS = {
  ok: { Icon: CheckIcon, className: "text-muted-foreground" },
  failed: { Icon: CircleAlertIcon, className: "text-error-foreground" },
  needed: { Icon: Clock3Icon, className: "text-muted-foreground" },
  waiting: { Icon: Clock3Icon, className: "text-muted-foreground" },
  // Hollow: nothing reported yet, never a failure.
  unknown: { Icon: CircleIcon, className: "text-muted-foreground" },
} as const satisfies Record<MergeReadinessStatus, unknown>;

/**
 * The merge checklist on Summary (board 13): one worded row per requirement with its status in a
 * word, and the action that clears it where this panel has one. The count leaves out what the
 * host could not report. Only an unmet row is tinted, and only its icon and word.
 */
function PullRequestMergeReadinessChecklist({
  readiness,
  ownReviewLine,
  actions,
}: {
  readiness: MergeReadiness;
  /** "Your own review: 2 of 5 files, ...": advisory, neutral, and never counted above. */
  ownReviewLine: string | null;
  /** Rendered before a row's status word, keyed by that row's action. */
  actions: Partial<Record<NonNullable<MergeReadiness["rows"][number]["action"]>, ReactNode>>;
}) {
  return (
    <section aria-label="Merge readiness" className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Merge readiness</h2>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {mergeReadinessCountLabel(readiness)}
        </span>
      </div>
      <ul className="flex flex-col rounded-xl border border-border bg-surface-raised px-3 py-1">
        {readiness.rows.map((row, index) => {
          const status = READINESS_STATUS[row.status];
          const action = row.action === null ? null : actions[row.action];
          return (
            <li
              key={row.key}
              className={cn(
                "flex min-h-10 min-w-0 items-center gap-2.5",
                index > 0 && "border-t border-border",
              )}
            >
              <status.Icon aria-hidden className={cn("size-3.5 shrink-0", status.className)} />
              <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
              {row.detail ? (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {row.detail}
                </span>
              ) : null}
              {action ? <span className="flex shrink-0 gap-1.5">{action}</span> : null}
              <span
                className={cn(
                  "shrink-0 text-xs font-medium",
                  row.status === "failed" ? "text-error-foreground" : "text-muted-foreground",
                )}
              >
                {row.word}
              </span>
            </li>
          );
        })}
      </ul>
      {ownReviewLine ? (
        <p className="px-0.5 text-xs text-muted-foreground">{ownReviewLine}</p>
      ) : null}
    </section>
  );
}

export function PullRequestDetailPanel({
  environmentId,
  shortcutsEnabled,
  getShortcutContext,
  threadRef = null,
  reference: requestedReference,
  listEntry = null,
  refreshToken: forcedRefreshToken = 0,
  onActed,
  onClose,
  context = "page",
  composerDraftTarget,
  onBack,
  onSelectPullRequest,
}: {
  environmentId: EnvironmentId;
  shortcutsEnabled: boolean;
  getShortcutContext: () => ShortcutMatchContext;
  onSelectPullRequest?: ((reference: PullRequestRef) => void) | undefined;
  /**
   * The thread this panel sits beside, if any. Links that are not the pull
   * request itself (check details, host permalinks) can open in that thread's
   * in-app browser when the user has asked for it; the page has no thread, so
   * there they always go to the system browser.
   */
  threadRef?: ScopedThreadRef | null;
  reference: PullRequestRef;
  /** Row fields already loaded by the pull-request list, used while richer detail arrives. */
  listEntry?: PullRequestListEntry | null;
  /**
   * Bumped by whatever holds the panel when a reader asks for everything on screen to be read
   * again. The panel owns its own reads, so the page cannot refresh them for it — it says when,
   * and this says it.
   */
  refreshToken?: number;
  /**
   * An action changed this pull request on the host, so a list showing it is now out of date.
   * Told rather than assumed: only the page knows whether it is showing one.
   */
  onActed?: () => void;
  /** Page-owned detail columns use this to clear the selected pull request. */
  onClose?: () => void;
  /**
   * Beside a thread, the checkout affordance disappears: the panel is showing that thread's
   * own pull request, so the branch is already under the reader's feet — and checking it out
   * again is at best a no-op and at worst git refusing a branch two checkouts.
   */
  context?: "page" | "thread";
  /** The open thread's composer. */
  composerDraftTarget?: ScopedThreadRef | DraftId;
  /**
   * Beside a thread, the way back to that thread's list of pull requests. The tab strip can
   * close this surface, but closing is not going back: the reader came from the list and
   * expects to land on it, with this one still open behind.
   */
  onBack?: (() => void) | undefined;
}) {
  const environmentConfigs = useServerConfigs();
  const projects = useProjects();
  const project = projects.find(
    (project) =>
      project.id === requestedReference.projectId && project.environmentId === environmentId,
  );
  const repositoryIdentity = project?.repositoryIdentity;
  const supportsThreadPullRequests =
    environmentConfigs.get(environmentId)?.environment.capabilities.threadPullRequests === true;
  const reference = useMemo(
    () =>
      supportsThreadPullRequests
        ? resolvePullRequestReferenceHost(requestedReference, repositoryIdentity)
        : {
            projectId: requestedReference.projectId,
            repository: requestedReference.repository,
            number: requestedReference.number,
          },
    [requestedReference, repositoryIdentity, supportsThreadPullRequests],
  );
  const pullRequestKey = `${reference.projectId}:${reference.host ?? ""}:${reference.repository}#${reference.number}`;
  const matchingListEntry =
    listEntry?.projectId === reference.projectId &&
    listEntry.repository.toLowerCase() === reference.repository.toLowerCase() &&
    (reference.host === undefined ||
      listEntry.host.toLowerCase() === reference.host.toLowerCase()) &&
    listEntry.number === reference.number
      ? listEntry
      : null;
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("summary");
  // What the Code tab says about its own review footer and comment draft, which decides whether
  // the merge button may hold the screen's one fill while the Code tab is shown.
  const [codeFillInputs, setCodeFillInputs] = useState<PullRequestCodeFillInputs>({
    reviewStepPending: false,
    commentDraftOpen: false,
  });
  const [timelineOrder, setTimelineOrder] = useState<"newest" | "oldest">("newest");
  const [codeCommitScope, setCodeCommitScope] = useState<{
    readonly pullRequestKey: string;
    readonly oid: string | null;
  }>(() => ({ pullRequestKey, oid: null }));
  const selectedCodeCommitOid =
    codeCommitScope.pullRequestKey === pullRequestKey ? codeCommitScope.oid : null;
  const selectCodeCommit = (oid: string | null) => {
    setCodeCommitScope({ pullRequestKey, oid });
  };
  const openCommit = (oid: string) => {
    selectCodeCommit(oid);
    setTab("code");
  };
  // Every tab the reader has opened stays mounted behind the active one. The diff viewer
  // always needed this (it virtualizes against its own scroll position); the trace showed the
  // summary needs it too — a large description re-parses its whole markdown on every return
  // to the tab. `visibility` keeps boxes, sizes and scroll offsets, and takes hidden content
  // out of the tab order and the accessibility tree.
  const tabScopeKey = `${environmentId}:${pullRequestKey}`;
  const [tabMountState, setTabMountState] = useState(() => ({
    key: tabScopeKey,
    tabs: new Set<DetailTab>(["summary"]),
  }));
  // A previously visited Code tab must not fetch diffs for every later PR while hidden.
  const mountedTabs =
    tabMountState.key === tabScopeKey ? tabMountState.tabs : new Set<DetailTab>([tab]);
  useEffect(() => {
    setTabMountState((previous) => {
      if (previous.key !== tabScopeKey) return { key: tabScopeKey, tabs: new Set([tab]) };
      if (previous.tabs.has(tab)) return previous;
      return { key: tabScopeKey, tabs: new Set(previous.tabs).add(tab) };
    });
  }, [tab, tabScopeKey]);
  const lastSelectedMergeMethod = useUiStateStore((state) => state.pullRequestMergeMethod);
  const setLastSelectedMergeMethod = useUiStateStore((state) => state.setPullRequestMergeMethod);
  // Server-side and per project, like every other project setting. The
  // client-local per-project map from before still answers when the server
  // has no value, so a choice made on an older release keeps applying until
  // it is set (or reset) in Settings.
  const legacyMergeMethodOverrides = useClientSettings(
    (settings) => settings.pullRequestMergeMethodOverrides,
  );
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectDefaultMergeMethod =
    resolveProjectSettings(
      environmentConfigs.get(environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS,
      reference.projectId,
    ).settings.pullRequestMergeMethod ?? undefined;
  const [mergeMethodSelection, setMergeMethodSelection] = useState<{
    readonly pullRequestKey: string;
    readonly method: PullRequestMergeMethod;
  } | null>(null);
  const setMergeMethod = (method: PullRequestMergeMethod) => {
    setMergeMethodSelection({ pullRequestKey, method });
  };
  const [confirmation, setConfirmation] = useState<{
    readonly open: boolean;
    readonly action: "merge" | "close" | "enable-auto-merge" | "revert" | "approve-workflows";
  }>({ open: false, action: "merge" });
  const confirmAction = confirmation.action;
  // Which handoff is preparing, keyed so a per-finding button can say "Preparing..." on itself
  // alone. One at a time whatever the key: they all check the same pull request out.
  const [handoff, setHandoff] = useState<string | null>(null);
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  const activityQuery = useEnvironmentQuery(
    pullRequestEnvironment.activity({ environmentId, input: reference }),
  );
  const turnRefresh = usePullRequestTurnRefresh(environmentId);
  const [cachedDetail, setCachedDetail] = useState(() =>
    readPullRequestDetailSnapshot(
      typeof window === "undefined" ? undefined : window.localStorage,
      environmentId,
      reference,
    ),
  );
  useEffect(() => {
    setCachedDetail(
      readPullRequestDetailSnapshot(
        typeof window === "undefined" ? undefined : window.localStorage,
        environmentId,
        reference,
      ),
    );
  }, [environmentId, pullRequestKey, reference.projectId, reference.repository, reference.number]);
  useEffect(() => {
    if (detailQuery.data === null) return;
    writePullRequestDetailSnapshot(
      typeof window === "undefined" ? undefined : window.localStorage,
      environmentId,
      reference,
      detailQuery.data,
    );
    setCachedDetail(detailQuery.data);
  }, [
    detailQuery.data,
    environmentId,
    pullRequestKey,
    reference.projectId,
    reference.repository,
    reference.number,
  ]);
  const resolvedCoreDetail = resolveDisplayedPullRequestDetail({
    live: detailQuery.data,
    cached: cachedDetail,
    reference,
  });
  const listSummary = useMemo(
    () => (matchingListEntry === null ? null : pullRequestListEntryToSummary(matchingListEntry)),
    [matchingListEntry],
  );
  const detailSummary = useMemo(
    () =>
      detailQuery.data === null
        ? null
        : {
            ...detailQuery.data,
            checksState: pullRequestChecksState(detailQuery.data.checks),
          },
    [detailQuery.data],
  );
  const observedSummary = useSharedPullRequestSummary(
    environmentId,
    reference,
    detailSummary,
    detailQuery.dataUpdatedAt,
  );
  // The list row is also published to the shared cache, but only after this commit's layout
  // effects run, so it is compared directly rather than trusted to be there already.
  const sharedSummary = useMemo(
    () =>
      newestPullRequestSummary(
        resolvedCoreDetail,
        newestPullRequestSummary(observedSummary, listSummary),
      ),
    [resolvedCoreDetail, observedSummary, listSummary],
  );
  const coreDetail = useMemo(
    () =>
      resolvedCoreDetail === null || sharedSummary === null || sharedSummary === resolvedCoreDetail
        ? resolvedCoreDetail
        : {
            ...resolvedCoreDetail,
            title: sharedSummary.title,
            state: sharedSummary.state,
            headBranch: sharedSummary.headBranch,
            baseBranch: sharedSummary.baseBranch,
            updatedAt: sharedSummary.updatedAt,
            author: sharedSummary.author ?? resolvedCoreDetail.author,
            additions: sharedSummary.additions ?? resolvedCoreDetail.additions,
            deletions: sharedSummary.deletions ?? resolvedCoreDetail.deletions,
            changedFiles: sharedSummary.changedFiles ?? resolvedCoreDetail.changedFiles,
            mergeability: sharedSummary.mergeability ?? resolvedCoreDetail.mergeability,
            closedAt:
              sharedSummary.closedAt === undefined
                ? resolvedCoreDetail.closedAt
                : sharedSummary.closedAt,
            mergedAt:
              sharedSummary.mergedAt === undefined
                ? resolvedCoreDetail.mergedAt
                : sharedSummary.mergedAt,
            // A summary may come from an older server that does not report draft state. Keep the
            // detail's required value instead of making the complete detail shape partial.
            isDraft: sharedSummary.isDraft ?? resolvedCoreDetail.isDraft,
          },
    [resolvedCoreDetail, sharedSummary],
  );
  const activity = activityQuery.data;
  const detail = useMemo(
    () =>
      coreDetail === null
        ? null
        : {
            ...coreDetail,
            author: activity?.author ?? coreDetail.author,
            reviewers: activity?.reviewers ?? coreDetail.reviewers,
            comments: activity?.comments ?? [],
            commentCount: activity?.commentCount ?? 0,
            commentsTruncated: activity?.commentsTruncated ?? false,
            reviewThreads: activity?.reviewThreads ?? [],
            commits: activity?.commits ?? [],
            reactions: activity?.reactions ?? [],
          },
    [activity, coreDetail],
  );
  const handoffSummary = detail ?? sharedSummary;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { copyToClipboard: copyReference } = useCopyToClipboard<string>({
    target: "pull request reference",
    onCopy: (label) => toastManager.add({ type: "success", title: `${label} copied` }),
    onError: (error, label) =>
      toastManager.add({
        type: "error",
        title: `Failed to copy ${label}`,
        description: error.message,
      }),
  });
  const copyFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!shortcutsEnabled || event.defaultPrevented || isCommandPaletteOpen()) return;
    const command = resolveShortcutCommand(event, keybindings, {
      context: getShortcutContext(),
    });
    if (command !== "pullRequest.copyNumber") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) copyReference(`#${reference.number}`, "PR number");
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => copyFromShortcut(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  useEffect(() => {
    if (detail?.autoMergeMethod !== undefined) setMergeMethod(detail.autoMergeMethod);
  }, [detail?.autoMergeMethod, pullRequestKey]);
  const repositoryUrl = detail === null ? null : changeRequestRepositoryUrl(detail.url);
  const markdownContext = useMemo(
    () => ({ repositoryUrl: detail?.provider === "github" ? repositoryUrl : null, threadRef }),
    [detail?.provider, repositoryUrl, threadRef],
  );
  const checkoutCommand = handoffSummary
    ? pullRequestCheckoutCommand(
        handoffSummary.provider,
        handoffSummary.number,
        handoffSummary.headBranch,
        detail?.headRepositoryNameWithOwner,
        changeRequestRepositoryUrl(handoffSummary.url),
      )
    : loadingPullRequestCheckoutCommand(reference, repositoryIdentity);
  const branchRefsQuery = useEnvironmentQuery(
    detail === null
      ? null
      : vcsEnvironment.listRefs({
          environmentId,
          input: {
            cwd: detail.workspaceRoot,
            includeMatchingRemoteRefs: true,
            // listRefs keeps the current ref first and a known default second.
            limit: 2,
          },
        }),
  );
  // "Your own review" under Merge readiness: the same viewed marks the Code tab reads (one shared
  // query per pull request), and the review comments written here and not yet submitted.
  const ownReviewMarksQuery = useEnvironmentQuery(
    detail?.state === "open" && detail.capabilities.viewedFiles !== undefined
      ? pullRequestEnvironment.filesViewed({ environmentId, input: reference })
      : null,
  );
  const unsentReviewComments = usePendingReviewComments(reference).length;
  const ownReviewLine =
    detail?.state === "open"
      ? pullRequestOwnReviewLine({
          changedFiles: detail.changedFiles,
          viewedFiles:
            detail.capabilities.viewedFiles === undefined
              ? null
              : (ownReviewMarksQuery.data?.files.filter((file) => file.state === "viewed").length ??
                0),
          unsentComments: unsentReviewComments,
        })
      : null;
  const isStackedPullRequest =
    detail !== null &&
    isStackedPullRequestBase(detail.baseBranch, branchRefsQuery.data?.refs ?? []);
  // The host's own stack, where it keeps one. Only asked for once the detail has landed so a
  // pull request nobody can read costs one request rather than two.
  const stackReference = useMemo(
    () =>
      detail === null || detail.capabilities.stacks !== true || !supportsThreadPullRequests
        ? null
        : { ...reference, host: reference.host ?? parseChangeRequestUrl(detail.url)?.host },
    [detail, reference, supportsThreadPullRequests],
  );
  const nativeStackQuery = usePullRequestStack(environmentId, stackReference);
  const nativeStack = nativeStackQuery.data;
  const supportsStackActions =
    supportsThreadPullRequests &&
    detail?.capabilities.stacks === true &&
    detail.capabilities.stackActions === true &&
    environmentConfigs.get(environmentId)?.environment.capabilities.pullRequestStackActions ===
      true;
  const canMergeSinglePullRequest = allowsSinglePullRequestMerge({
    supportsStackActions,
    hasStack: nativeStack !== null,
    stackPending: !nativeStackQuery.isSuccess || nativeStackQuery.isPending,
    stackError: nativeStackQuery.error,
  });
  const activityPending = activityQuery.isPending && activity === null;
  const activityError = activity === null ? activityQuery.error : null;
  const refreshDetail = useCallback(() => {
    detailQuery.refresh();
    activityQuery.refresh();
    nativeStackQuery.refresh();
  }, [activityQuery.refresh, detailQuery.refresh, nativeStackQuery.refresh]);
  const [refreshToken, setRefreshToken] = useState(0);
  const codeRefreshToken = refreshToken + (turnRefresh ?? 0);
  const activityRevision = useRef<{ readonly key: string; readonly updatedAt: string } | null>(
    null,
  );
  useEffect(() => {
    if (!coreDetail) return;
    const next = { key: tabScopeKey, updatedAt: coreDetail.updatedAt };
    if (shouldRefreshPullRequestActivity(activityRevision.current, next)) {
      // Let an existing read settle before revalidating the new revision. Interrupting a
      // mutation's activity refresh can leave SWR displaying its previous value.
      if (activityQuery.isPending) return;
      activityQuery.refresh();
      setRefreshToken((token) => token + 1);
    }
    activityRevision.current = next;
  }, [activityQuery.isPending, activityQuery.refresh, coreDetail, tabScopeKey]);
  // Reuse activity and diff until core detail reports a changed revision. Keyed by
  // the pull request rather than by the panel, because this one panel shows a different pull
  // request every time it is opened.
  useLiveRefresh(
    () => {
      detailQuery.refresh();
    },
    { key: `pull-request:${environmentId}:${pullRequestKey}` },
  );
  // The button, on the other hand, goes around the server's cache rather than through it: it is
  // the answer for a reader who can see that what they are looking at is behind. The
  // invalidation goes first so the re-reads miss that cache; if it fails, the reads still run
  // and at worst answer from it.
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  const [isInvalidating, setIsInvalidating] = useState(false);
  // One word for "the host is being asked again", whichever of the two halves is in flight:
  // the invalidation round trip, then the detail read it kicks off.
  const refreshing = isInvalidating || detailQuery.isPending;
  const refreshFromHost = useCallback(async () => {
    setIsInvalidating(true);
    try {
      await invalidate({ environmentId, input: { reference } });
      refreshDetail();
      setRefreshToken((token) => token + 1);
    } finally {
      setIsInvalidating(false);
    }
  }, [environmentId, invalidate, reference, refreshDetail]);
  // A refresh asked for by the page: the detail, and through the token below, the diff with it.
  const appliedForcedToken = useRef(forcedRefreshToken);
  useEffect(() => {
    if (appliedForcedToken.current === forcedRefreshToken) return;
    appliedForcedToken.current = forcedRefreshToken;
    void refreshFromHost();
  }, [forcedRefreshToken, refreshFromHost]);
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const postComment = useAtomCommand(pullRequestEnvironment.comment, { reportFailure: false });
  // Which action is in flight, not merely that one is: every control here is disabled while any
  // of them runs, but only the button that was pressed may say what it is doing.
  const [pendingAction, setPendingAction] = useState<PullRequestAction | null>(null);
  const actionPending = pendingAction !== null;
  // The host's sentence from the last refused merge, said in the merge footer until the next try.
  const [mergeRefusal, setMergeRefusal] = useState<{
    readonly pullRequestKey: string;
    readonly reason: string;
  } | null>(null);
  const update = useAtomCommand(pullRequestEnvironment.update, { reportFailure: false });
  // Scoped to the pull request it was typed against, since this one panel shows a different one
  // every time it is opened and a half-written title must not follow it there.
  const [titleScope, setTitleScope] = useState<{
    readonly pullRequestKey: string;
    readonly text: string;
  } | null>(null);
  const titleDraft = titleScope?.pullRequestKey === pullRequestKey ? titleScope.text : null;
  const [titleSaving, setTitleSaving] = useState(false);
  const newThread = useNewThreadHandler();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const unavailableGitHubUrl = useMemo(() => {
    const identity = projects.find(
      (project) => project.id === reference.projectId && project.environmentId === environmentId,
    )?.repositoryIdentity;
    return gitHubPullRequestBrowserUrl(identity, reference.repository, reference.number);
  }, [environmentId, projects, reference.number, reference.projectId, reference.repository]);
  // Project settings stored the override under the sidebar group's key, which a duplicate row
  // borrows from its siblings, so the project alone does not always name the same key.
  const legacyProjectDefaultMergeMethod = useMemo(() => {
    if (projectDefaultMergeMethod !== undefined) return undefined;
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === environmentId && candidate.id === reference.projectId,
    );
    if (!project) return undefined;
    const projectKey =
      buildPhysicalToLogicalProjectKeyMap({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
      }).get(derivePhysicalProjectKey(project)) ??
      deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings);
    return legacyMergeMethodOverrides[projectKey];
  }, [
    environmentId,
    legacyMergeMethodOverrides,
    primaryEnvironmentId,
    projectDefaultMergeMethod,
    projectGroupingSettings,
    projects,
    reference.projectId,
  ]);
  // Beside a thread there is nothing to pick: the hand-offs land in that thread's composer, and
  // the thread is already on one server's copy of the branch.
  const pickableEnvironments = useMemo(
    () =>
      context === "page"
        ? resolvePickableEnvironments(
            { environmentId, projectId: reference.projectId },
            projects,
            environments.map((environment) => ({
              environmentId: environment.environmentId,
              label: environment.label,
              machine: resolveEnvironmentMachineKind(environment.serverConfig),
            })),
          )
        : [],
    [context, environmentId, environments, projects, reference.projectId],
  );
  // Which server the reader chose, and only for the pull request they chose it on: this one panel
  // shows a different pull request every time it is opened, and the choice does not follow.
  const [actingScope, setActingScope] = useState<{
    readonly pullRequestKey: string;
    readonly environmentId: EnvironmentId;
  } | null>(null);
  const chosenEnvironmentId =
    actingScope?.pullRequestKey === pullRequestKey ? actingScope.environmentId : environmentId;
  // Null wherever there is no choice on offer — one server, or a chosen one that has since gone —
  // and then the panel's own server and its own checkout are the answer, as they always were.
  const acting =
    pickableEnvironments.find((entry) => entry.environmentId === chosenEnvironmentId) ?? null;
  const actingEnvironmentId = acting?.environmentId ?? environmentId;
  const checkoutRoot =
    acting?.workspaceRoot ?? detail?.workspaceRoot ?? project?.workspaceRoot ?? null;
  const prepareThread = usePreparePullRequestThreadAction({
    environmentId: actingEnvironmentId,
    cwd: checkoutRoot,
  });

  const finishAction = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    const result = await runAction({
      environmentId,
      input: {
        ...reference,
        action,
        ...(method ? { mergeMethod: method } : {}),
        ...(updateMethod ? { updateMethod } : {}),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      // The host's own sentence, because it is the only thing that says why. A merge strategy a
      // branch policy forbids is refused at completion and nowhere earlier — Azure DevOps
      // publishes no per-strategy availability to hide the control with — so "action failed"
      // would leave the reader pressing the same button again.
      const failure = squashAtomCommandFailure(result);
      // The hint stands for what was actually asked for: a reader who pressed Update branch is
      // told to check their access, not offered the merge commit they already chose.
      const hint =
        updateMethod === "rebase"
          ? UPDATE_BRANCH_REBASE_FAILURE_HINT
          : ACTION_FAILURE_HINTS[action];
      const reason = readableFailure(failure, hint);
      if (action === "merge") setMergeRefusal({ pullRequestKey, reason });
      toastManager.add({
        type: "error",
        title: ACTION_FAILURE_LABELS[action],
        description: reason,
      });
      return false;
    }
    if (action === "merge") setMergeRefusal(null);
    toastManager.add({ type: "success", title: ACTION_SUCCESS_LABELS[action] });
    // A branch update moves the head commit, which leaves the diff atom pointed at a comparison
    // that no longer exists — the same staleness the manual refresh button fixes, so it goes
    // through that path rather than a second one. Every other action here only changes metadata;
    // a merge does move the branch too, but it also closes the pull request, where the diff is
    // no longer what anyone is looking at.
    if (pullRequestActionNeedsHostRefresh(action)) {
      void refreshFromHost();
    } else {
      refreshDetail();
    }
    onActed?.();
    return true;
  };

  const perform = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    if (pendingAction !== null) return false;
    setPendingAction(action);
    return finishAction(action, method, updateMethod);
  };

  const performCommentAction = async (body: string, action: "close" | "reopen") => {
    if (pendingAction !== null) return { commentPosted: false };
    setPendingAction(action);
    const commentResult = await postComment({
      environmentId,
      input: { ...reference, body },
    });
    if (commentResult._tag === "Failure") {
      setPendingAction(null);
      toastManager.add({ type: "error", title: "Could not post the comment" });
      return { commentPosted: false };
    }
    const actionSucceeded = await finishAction(action);
    // The comment is durable even if the state change was refused, so make it visible while the
    // shared action failure explains why the pull request stayed where it was.
    if (!actionSucceeded) refreshDetail();
    return { commentPosted: true };
  };

  const saveTitle = async (next: string) => {
    const title = next.trim();
    if (detail === null || titleSaving) return;
    if (title.length === 0 || title === detail.title) {
      setTitleScope(null);
      return;
    }
    setTitleSaving(true);
    const result = await update({ environmentId, input: { ...reference, title } });
    setTitleSaving(false);
    if (result._tag === "Failure") {
      // The draft stays open with the words still in it: retyping a title somebody has just
      // rewritten is the one thing a failed save must not cost them.
      toastManager.add({
        type: "error",
        title: "The title could not be saved",
        description: readableFailure(
          squashAtomCommandFailure(result),
          "The host refused the new title.",
        ),
      });
      return;
    }
    setTitleScope(null);
    refreshDetail();
  };

  type ThreadTask = {
    prompt: string;
    reviewComments?: ReadonlyArray<ReviewCommentContext>;
  };

  const attachTarget = composerDraftTarget ?? null;
  // While the composer holds text, Send owns the screen's one filled button.
  const composerHasText = useComposerHasText(attachTarget);
  const handoffLabels = pullRequestHandoffLabels(attachTarget !== null);
  const threadSession = useThread(threadRef)?.session;
  const threadProviderName = threadSession?.providerName
    ? (PROVIDER_DISPLAY_NAMES[threadSession.providerName as ProviderDriverKind] ?? null)
    : null;
  const openLink = useOpenLink(threadRef);

  const writeTaskToComposer = (target: ScopedThreadRef | DraftId, task: ThreadTask) => {
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(target);
    const key = composerTargetKey(target);
    const previousCommentIds = new Set((draft?.reviewComments ?? []).map((comment) => comment.id));
    const repeatedCommentIds = new Set(
      (task.reviewComments ?? [])
        .filter((comment) => previousCommentIds.has(comment.id))
        .map((comment) => comment.id),
    );
    const promptWithoutPreviousHandoff = stripPullRequestHandoffReferences(
      draft?.prompt ?? "",
      draft?.reviewComments ?? [],
      repeatedCommentIds,
    );
    const prompt = handoffPrompt(
      {
        prompt: promptWithoutPreviousHandoff,
        lastHandoffPrompt: lastHandoffPromptByDraft.get(key),
      },
      task.prompt,
    );
    lastHandoffPromptByDraft.set(key, task.prompt);
    store.setPrompt(target, prompt);
    store.setReviewComments(
      target,
      handoffReviewComments(draft?.reviewComments ?? [], task.reviewComments ?? []),
    );
    for (const comment of task.reviewComments ?? []) {
      if (!repeatedCommentIds.has(comment.id)) continue;
      store.addReviewComment(target, comment, {
        allowDuplicateReference: true,
        insertAtCaret: false,
      });
    }
  };

  /**
   * Opens a thread on this project and leaves the task in its composer for the reader to send.
   *
   * Nothing is checked out: asking a question is not a reason to move somebody's working tree or
   * to make a worktree they did not ask for. The two hand-offs that do need the code call this
   * after preparing it, so there is one path from "a task" to "a thread holding it".
   */
  const openThreadWithTask = async (
    projectRef: ReturnType<typeof scopeProjectRef>,
    task: ThreadTask | null,
    opened?: { draftId: DraftId },
  ): Promise<{ draftId: DraftId } | null> => {
    const session =
      opened ??
      (await newThread(projectRef).then(
        (result) => result,
        () => null,
      ));
    if (session === null) return null;
    if (task === null) return session;
    // The latest press is the ask: it takes over what an earlier hand-off left, prompt and chips
    // both, rather than stacking a second one under the first. What the reader typed themselves
    // survives — the composer they are handed is not always a fresh one, and a prompt they have
    // since edited is theirs rather than the hand-off's.
    writeTaskToComposer(session.draftId, task);
    return session;
  };

  /** A question about the change, which needs a thread and nothing else. */
  const startAsk = async (kind: string, task: ThreadTask) => {
    if (!detail || handoff !== null) return;
    if (attachTarget !== null) {
      writeTaskToComposer(attachTarget, task);
      toastManager.add({
        type: "success",
        title: "Added to the composer",
        description:
          task.prompt.length > 0
            ? "The request is in the composer — read it over, then send."
            : "The pull request is in the composer — type your question, then send.",
      });
      return;
    }
    setHandoff(kind);
    const projectRef = scopeProjectRef(actingEnvironmentId, acting?.projectId ?? detail.projectId);
    const opened = await openThreadWithTask(projectRef, task);
    setHandoff(null);
    if (opened === null) {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Try again from the project, or open a thread first.",
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: "Asked in a thread",
      // "Ask" leaves the composer empty on purpose, so saying the question is in it would send
      // the reader looking for something that is not there. The chips are what landed.
      description:
        task.prompt.length > 0
          ? "The request is in the composer — read it over, then send."
          : "The pull request is in the composer — type your question, then send.",
    });
  };

  // Every handoff works the same way: check the pull request out into its own worktree, open a
  // thread there, and — when it carries a task — put that in the composer for the user to read
  // before sending. Checking out is the whole point of the ones that carry nothing.
  const startHandoff = async (
    kind: string,
    task: { prompt: string; reviewComments?: ReadonlyArray<ReviewCommentContext> } | null,
    // A worktree leaves whatever is open alone, which is why it is the default. Checking out in
    // the repository itself is what you want when the point is to run the thing where you
    // already work — and it moves the branch under everything else that is open there.
    mode: "worktree" | "local" = "worktree",
  ) => {
    if (!handoffSummary || handoff !== null) return;
    if (attachTarget !== null && task !== null) {
      writeTaskToComposer(attachTarget, task);
      toastManager.add({
        type: "success",
        title: "Added to the composer",
        description: "The task is in the composer — read it over, then send.",
      });
      return;
    }
    if (checkoutRoot === null) return;
    setHandoff(kind);
    // The menu closes on the press and takes its "Preparing..." label with it, so this is the
    // only thing answering for the checkout. It carries no timeout of its own: a loading toast
    // never expires, and an explicit one would survive the update and pin the result on screen.
    const toastId = toastManager.add({
      type: "loading",
      title: "Preparing the pull request checkout...",
    });
    // Wherever the reader chose to act: the thread, the checkout it is pointed at and the composer
    // the task lands in are all one server's, and picking another one moves all three.
    const projectRef = scopeProjectRef(
      actingEnvironmentId,
      acting?.projectId ?? handoffSummary.projectId,
    );
    // The thread is opened before the checkout rather than after it, because the project's setup
    // script only runs for a checkout that knows which thread it is for — and a worktree with no
    // dependencies installed is not something anyone can test.
    const opened = await newThread(projectRef).then(
      (session) => session,
      () => null,
    );
    if (opened === null) {
      setHandoff(null);
      // Without a thread there is nowhere for the checkout to belong: its setup script would not
      // run and its task would have no composer to land in. Better to stop before touching the
      // working tree than to prepare a worktree nobody asked for.
      toastManager.update(toastId, {
        type: "error",
        title: "Could not open a thread for the checkout",
        description: "Try again from the project, or open a thread first.",
      });
      return;
    }
    const prepared = await prepareThread.run({
      reference: handoffSummary.url,
      mode,
      threadId: opened.threadId,
    });
    if (prepared._tag === "Failure") {
      setHandoff(null);
      // The server says what to do about it — that the branch is already checked out in the main
      // repository, say — and that sentence is the only way out of the failure.
      const detailMessage =
        prepareThread.error instanceof Error ? prepareThread.error.message : null;
      toastManager.update(toastId, {
        type: "error",
        title: "Could not prepare the pull request checkout",
        ...(detailMessage ? { description: detailMessage } : {}),
      });
      return;
    }
    // The same thread again, now that there is somewhere to point it at. A local checkout has
    // no worktree of its own, so the thread runs where the repository already is.
    const pointed = await newThread(projectRef, {
      branch: prepared.value.branch,
      worktreePath: prepared.value.worktreePath,
      envMode: prepared.value.worktreePath === null ? "local" : "worktree",
    }).then(
      (session) => session !== null,
      () => false,
    );
    if (!pointed) {
      setHandoff(null);
      // The checkout is on disk; only the thread failed to move onto it. Writing the task now
      // would send the agent at whatever the thread was already open on — which is the one
      // outcome worth stopping for, since it reads as success and is not.
      toastManager.update(toastId, {
        type: "error",
        title: "Checked out, but the thread stayed where it was",
        description: `The checkout is ready on \`${prepared.value.branch}\`. Point a thread at it from the branch picker, then ask again.`,
      });
      return;
    }
    // Released here whatever happened next: a loading toast never expires on its own, so leaving
    // this set would spin forever and lock every handoff behind it until a reload.
    setHandoff(null);
    // A worktree that was already there and had been worked in keeps whatever it holds, so the
    // thread opens on older code than the pull request carries. Said once, in place of the
    // success, because everything else about the handoff did happen.
    const staleCheckoutToast = {
      type: "warning",
      title: "Checked out, but not on the latest commits",
      description:
        "The checkout could not be moved onto the pull request's latest commits, so the code there is older than the pull request. Uncommitted work or local commits keep it where it is.",
    } as const;
    if (task === null) {
      toastManager.update(
        toastId,
        prepared.value.isOnPullRequestHead
          ? {
              type: "success",
              title: mode === "local" ? "Checked out here" : "Checked out",
              description:
                mode === "local"
                  ? "This repository is on the pull request's branch, with a thread open on it."
                  : "The pull request is in its own worktree, with a thread open on it.",
            }
          : staleCheckoutToast,
      );
      return;
    }
    await openThreadWithTask(projectRef, task, opened);
    toastManager.update(
      toastId,
      prepared.value.isOnPullRequestHead
        ? {
            type: "success",
            title: "Checkout ready",
            description: "The task is in the composer — read it over, then send.",
          }
        : staleCheckoutToast,
    );
  };

  const askAboutPullRequest = () => {
    if (!detail) return;
    void startAsk("ask", {
      ...buildAskAboutPullRequestHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        state: detail.state,
        isDraft: detail.isDraft,
      }),
    });
  };

  const explainPullRequest = () => {
    if (!detail) return;
    void startAsk("explain", {
      ...buildExplainPullRequestHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        state: detail.state,
        isDraft: detail.isDraft,
      }),
    });
  };

  const reviewPullRequest = () => {
    if (!detail) return;
    void startAsk("review", buildReviewPullRequestHandoff({ url: detail.url }));
  };

  const addSelectionToAgent = (selection: PullRequestAgentSelectionInput) => {
    if (!detail) return;
    void startAsk(
      `selection:${selection.comment.id}`,
      buildAddSelectionToAgentHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        state: detail.state,
        isDraft: detail.isDraft,
        comment: selection.comment,
        request: selection.request,
      }),
    );
  };

  const startCheckout = (mode: "worktree" | "local") => {
    if (!handoffSummary) return;
    void startHandoff(`checkout:${mode}`, null, mode);
  };

  /** One finding, handed over on its own — the surfaces that show findings call this. */
  const startFixFinding = (finding: PullRequestFinding) => {
    if (!detail) return;
    void startHandoff(
      pullRequestFindingKey(finding),
      buildFixFindingHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        finding,
      }),
    );
  };

  const startFixFindings = () => {
    if (!detail) return;
    void startHandoff(
      "findings",
      buildFixFindingsHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        reviewThreads: detail.reviewThreads,
        comments: detail.comments,
        checks: checksStale ? [] : detail.checks,
        commentsTruncated: detail.commentsTruncated,
      }),
    );
  };

  const startResolveConflicts = () => {
    if (!handoffSummary) return;
    void startHandoff("conflicts", {
      prompt: buildResolveConflictsPrompt({
        number: handoffSummary.number,
        url: handoffSummary.url,
        headBranch: handoffSummary.headBranch,
        baseBranch: handoffSummary.baseBranch,
      }),
    });
  };

  // The host says which strategies it offers at all; the repository narrows that to the ones
  // it actually allows.
  const allowedMergeMethods = detail
    ? detail.capabilities.mergeMethods.filter((method) => detail.mergeCapabilities[method])
    : [];
  const currentMergeMethod =
    mergeMethodSelection?.pullRequestKey === pullRequestKey ? mergeMethodSelection.method : null;
  const selectedMergeMethod = resolvePullRequestMergeMethod(
    allowedMergeMethods,
    currentMergeMethod,
    projectDefaultMergeMethod ?? legacyProjectDefaultMergeMethod,
    lastSelectedMergeMethod,
  );
  const selectedMergeMethodLabel = PULL_REQUEST_MERGE_METHOD_LABELS[selectedMergeMethod];
  const conflicting = detail?.state === "open" && detail.mergeability === "conflicting";
  // Only an outright yes arms it. A host that reports nothing has not said the merge is already
  // spoken for, and an off switch for something that may not be on says the wrong thing twice.
  const autoMergeArmed = detail?.state === "open" && detail.autoMergeEnabled === true;
  const workflowApprovalsRequired =
    detail?.state === "open" ? (detail.workflowApprovalsRequired ?? 0) : 0;
  // Out of date with the base, and still cleanly mergeable — the one pairing an update button
  // exists for. Null everywhere else, including hosts that cannot compare at all.
  const freshness = detail === null ? null : resolveBaseFreshness(detail);
  // A host that cannot produce a patch has no Code tab to open. While detail is loading the ghost
  // uses this optimistic tab set to reserve the same chrome; a host without a patch removes Code
  // when its capabilities arrive.
  const visibleTabs = TABS.filter(
    (item) => item.value !== "code" || detail === null || detail.capabilities.diff,
  );
  // The Code tab can be opened while the detail is still on its way, and the detail may then say
  // this host has no patch to show. The tab goes, so whoever was standing on it is moved back to
  // the summary rather than left looking at a panel that is no longer reachable.
  useEffect(() => {
    if (!visibleTabs.some((item) => item.value === tab)) setTab("summary");
  }, [tab, visibleTabs]);
  // Two questions, both of which have to say yes: whether this host can do it at all, and
  // whether this account may. A reader with read access on someone else's project sees the pull
  // request and none of the buttons that would only ever be refused.
  const can = (action: PullRequestAction) =>
    detail?.capabilities.actions.includes(action) === true &&
    detail.viewerPermissions.actions.includes(action);
  const detailChecksState = detail ? pullRequestChecksState(detail.checks) : null;
  const latestChecksState =
    sharedSummary?.checksState === undefined ? detailChecksState : sharedSummary.checksState;
  // List rollups can omit workflows awaiting approval. Only refreshed detail can clear those.
  const checksState =
    latestChecksState !== "failing" &&
    detail?.checks.some((check) => check.status === "action-required")
      ? "pending"
      : latestChecksState;
  // A newer rollup cannot tell us which runs changed or how many passed.
  const checksStale = checksState !== detailChecksState;
  // What the menu's action group holds. Named once so the separators around it are drawn from
  // the same answer as its contents, rather than on the assumption that it has any.
  const showsDraftToggle = detail?.state === "open" && can(detail.isDraft ? "ready" : "draft");
  const showsWorkflowApproval =
    workflowApprovalsRequired > 0 && !checksStale && can("approve-workflows");
  // "Merge when ready" (the host's auto-merge), one rule for the footer and the More menu. GitHub,
  // GitLab and Azure DevOps arm a merge for later; Bitbucket and Forgejo do not, so the host's
  // capability decides whether it is there at all. A draft or a conflicting branch cannot be armed:
  // nothing the host waits for clears either. An armed one can always be cancelled.
  const showsMergeWhenReady =
    canMergeSinglePullRequest &&
    detail?.state === "open" &&
    ((autoMergeArmed && can("disable-auto-merge")) ||
      (!autoMergeArmed &&
        !detail.isDraft &&
        !conflicting &&
        can("enable-auto-merge") &&
        allowedMergeMethods.length > 0));
  const showsMergeMethods =
    detail?.state === "open" &&
    can("merge") &&
    !detail.isDraft &&
    !conflicting &&
    allowedMergeMethods.length > 1;
  // The host's branch rules as of the detail read. A newer rollup than that read may already
  // have cleared the checks it counts, so a stale read leaves the verdict to the host's refusal.
  const mergeBlock = checksStale ? undefined : detail?.mergeBlock;
  // The footer's one merge control. Readiness rows do not gate it: the host decides, and says why
  // when it refuses. Only what makes a merge impossible from here disables it, which includes the
  // host's own branch rules where it reports them up front (`mergeBlock`).
  const canMergeHere =
    detail?.state === "open" &&
    canMergeSinglePullRequest &&
    can("merge") &&
    allowedMergeMethods.length > 0 &&
    mergeBlock === undefined;
  // The pull request number carries this state in the overview and the right-panel tab mirrors
  // it. Conflicts take the action slot while they need a person, but do not change the PR state.
  const statePresentation = detail
    ? resolvePullRequestState({ state: detail.state, isDraft: detail.isDraft })
    : null;
  // A merge while this pull request is open settles its state glyph once (board 10).
  const mergeMoment = useMomentCount(detail?.url ?? null, detail?.state === "merged");
  // Approvals that still stand, and only those. A superseded one is dimmed beside the reviewer
  // who gave it, so counting it here would have the header assert in a number what the row next
  // to it has just qualified.
  //
  // Not counted at all from a conversation this page only holds the recent end of: an approval
  // older than the window would be missing, and "1" beside a tick is read as the whole answer.
  // The Summary tab's row can say it may be short; a bare number cannot, so it stays away.
  const approvalCount =
    detail && !detail.commentsTruncated
      ? latestPullRequestReviewOutcomes(detail.comments, detail.commits).filter(
          (entry) => entry.outcome === "approved" && !entry.stale,
        ).length
      : 0;
  const reviewOutcomes = detail
    ? latestPullRequestReviewOutcomes(detail.comments, detail.commits)
    : [];
  // Requested reviewers without a standing verdict: the ones a review still waits on.
  const pendingReviewers = (detail?.reviewers ?? [])
    .filter(
      (actor) =>
        !reviewOutcomes.some(
          (entry) => !entry.stale && entry.actor?.login.toLowerCase() === actor.login.toLowerCase(),
        ),
    )
    .map((actor) => actor.login);
  const mergeReadiness = detail
    ? resolveMergeReadiness({
        state: detail.state,
        baseBranch: detail.baseBranch,
        pendingReviewers,
        checks: detail.checks,
        checksState,
        checksStale,
        reviewDecision: sharedSummary?.reviewDecision,
        approvalCount,
        mergeability: detail.mergeability,
        baseComparison: detail.baseComparison,
        behindBy: detail.behindBy,
      })
    : null;
  const nextStep = detail
    ? resolvePullRequestNextStep({
        provider: detail.provider,
        state: detail.state,
        isDraft: detail.isDraft,
        baseBranch: detail.baseBranch,
        canMerge: can("merge"),
        mergeability: detail.mergeability,
        checks: detail.checks,
        checksState,
        checksStale,
        reviewDecision: sharedSummary?.reviewDecision,
        approvalCount,
        changesRequestedBy:
          reviewOutcomes.find((entry) => entry.outcome === "changes-requested" && !entry.stale)
            ?.actor?.login ?? null,
        pendingReviewers,
        baseComparison: detail.baseComparison,
        behindBy: detail.behindBy,
        autoMergeEnabled: detail.autoMergeEnabled,
        unresolvedReviewThreads: detail.reviewThreads.filter(
          (thread) =>
            !thread.isResolved && thread.comments.some((comment) => comment.body.trim().length > 0),
        ).length,
        agentName: threadProviderName,
        inThisThread: attachTarget !== null,
        canHandOff: attachTarget !== null || checkoutRoot !== null,
        canUpdateBranch: (freshness?.methods.length ?? 0) > 0,
        canMarkReady: can("ready"),
        canRequestReview:
          detail.capabilities.reviewers.request &&
          detail.capabilities.reviewers.listCandidates &&
          detail.viewerPermissions.requestReviewers,
        canCancelAutoMerge: can("disable-auto-merge"),
        workflowApprovalsRequired: showsWorkflowApproval ? workflowApprovalsRequired : 0,
        canApproveWorkflows: showsWorkflowApproval,
      })
    : null;
  const runNextStepAction = (kind: PullRequestNextStepActionKind) => {
    if (!detail) return;
    switch (kind) {
      case "resolve-conflicts":
        startResolveConflicts();
        return;
      case "fix":
        startFixFindings();
        return;
      case "view-logs": {
        const failed = detail.checks.find(
          (check) =>
            (check.status === "failure" || check.status === "cancelled") && check.url !== null,
        );
        if (failed?.url) {
          void openLink(failed.url).catch(() =>
            toastManager.add({ type: "error", title: "Unable to open check details" }),
          );
        }
        return;
      }
      case "update-branch": {
        const method = freshness?.methods[0];
        if (method) void perform("update-branch", undefined, method);
        return;
      }
      case "ready":
        void perform("ready");
        return;
      case "cancel-auto-merge":
        void perform("disable-auto-merge");
        return;
      case "approve-workflows":
        setConfirmation({ open: true, action: "approve-workflows" });
        return;
      case "request-review":
        return;
    }
  };

  // Merging from the keyboard, and from the command palette, goes through the same confirmation
  // the button opens, and only while that button is live. The panel answers only when the reader
  // is working in it: focus inside, or the last click landed here.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pointerInPanel = useRef(false);
  const canMergeFromShortcut = shortcutsEnabled && canMergeHere && !actionPending;
  const mergeFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!canMergeFromShortcut || event.defaultPrevented || isCommandPaletteOpen()) return;
    // ⌘↵ also holds to allow a destructive command; while one waits in this
    // view the merge stands down, so one keypress can never do both.
    if (destructiveApprovalPendingIn(document)) return;
    const panel = panelRef.current;
    if (panel === null) return;
    const command = resolveShortcutCommand(event, keybindings, {
      context: { ...getShortcutContext(), editableFocus: isEditableFocused(event.target) },
    });
    if (command !== "pullRequest.merge") return;
    if (!panel.contains(document.activeElement) && !pointerInPanel.current) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) setConfirmation({ open: true, action: "merge" });
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => mergeFromShortcut(event);
    const onPointerDown = (event: PointerEvent) => {
      pointerInPanel.current =
        event.target instanceof Node && panelRef.current?.contains(event.target) === true;
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
  const publishMergeCommand = usePullRequestMergeCommandStore((state) => state.publish);
  const withdrawMergeCommand = usePullRequestMergeCommandStore((state) => state.withdraw);
  const mergeShortcutLabel = shortcutLabelForCommand(keybindings, "pullRequest.merge");
  const mergeCommandOwner = `${environmentId}:${pullRequestKey}`;
  const mergeCommandTitle = detail?.title ?? null;
  useEffect(() => {
    if (!canMergeFromShortcut || mergeCommandTitle === null) {
      withdrawMergeCommand(mergeCommandOwner);
      return;
    }
    publishMergeCommand({
      owner: mergeCommandOwner,
      number: reference.number,
      title: mergeCommandTitle,
      // Withdrawn the moment merging stops being on offer, so this never outlives the button.
      run: () => setConfirmation({ open: true, action: "merge" }),
    });
    return () => withdrawMergeCommand(mergeCommandOwner);
  }, [
    canMergeFromShortcut,
    mergeCommandOwner,
    mergeCommandTitle,
    publishMergeCommand,
    reference.number,
    withdrawMergeCommand,
  ]);

  const checkoutControl =
    context === "page" ? (
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                disabled={handoff !== null || checkoutRoot === null}
                render={
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={handoff?.startsWith("checkout") ? "Checking out..." : "Check out"}
                  >
                    <GitBranchIcon aria-hidden className="size-3.5" />
                    <span className="@max-[35rem]/pr-header:hidden">
                      {handoff?.startsWith("checkout") ? "Checking out..." : "Check out"}
                    </span>
                    <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
                  </Button>
                }
              />
            }
          />
          <TooltipPopup>Check out this pull request</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" side="bottom" className="min-w-72">
          <MenuItem onClick={() => startCheckout("worktree")}>
            <GitBranchIcon className="mt-1 size-3.5 shrink-0 self-start" />
            <span className="flex min-w-0 flex-col">
              <span>In a separate worktree</span>
              <span className="text-xs text-muted-foreground">
                Its own folder and thread. Nothing you have open moves.
              </span>
            </span>
          </MenuItem>
          <MenuItem onClick={() => startCheckout("local")}>
            <FolderGit2Icon className="mt-1 size-3.5 shrink-0 self-start" />
            <span className="flex min-w-0 flex-col">
              <span>In this repository</span>
              <span className="text-xs text-muted-foreground">
                Switches the branch you are working in, like `gh pr checkout`.
              </span>
            </span>
          </MenuItem>
          {pickableEnvironments.length > 0 ? (
            <ActOnEnvironmentPicker
              environments={pickableEnvironments}
              value={actingEnvironmentId}
              onChange={(next) => setActingScope({ pullRequestKey, environmentId: next })}
              disabled={handoff !== null}
            />
          ) : null}
        </MenuPopup>
      </Menu>
    ) : null;

  const hostName = detail ? pullRequestHostName(detail.provider) : "The host";
  const mergeRefusalReason =
    mergeRefusal?.pullRequestKey === pullRequestKey ? mergeRefusal.reason : null;
  // Why the footer's merge cannot go, or why the host refused it, in the host's own words where it
  // gave them. Nothing is predicted from the readiness rows: the host decides.
  const footerReason =
    detail?.state !== "open"
      ? null
      : !canMergeSinglePullRequest
        ? nativeStack !== null
          ? "This pull request is part of a stack. Merge it from the stack menu."
          : nativeStackQuery.error
            ? "The stack this may belong to could not be read."
            : "Checking whether this pull request is part of a stack."
        : !can("merge")
          ? `${hostName} does not let this account merge here.`
          : allowedMergeMethods.length === 0
            ? `${hostName} allows no merge method on this repository.`
            : mergeRefusalReason
              ? `${hostName} refused the merge: ${mergeRefusalReason}`
              : autoMergeArmed
                ? "Merge when ready is on"
                : hostMergeBlockReason(hostName, mergeBlock);
  const mergeButtonLabel = pendingAction === "merge" ? "Merging..." : selectedMergeMethodLabel;
  // One fill per screen: the merge holds it only once everything is met, and on the Code tab only
  // once the review footer has no step left; until then the card or the review step holds it.
  const fillHolder = panelFillHolder({
    view: {
      kind: "pull-request",
      tab,
      nextStepHasAction: nextStep?.primary != null,
      mergeReady: nextStep?.kind === "ready",
    },
    composerHasText,
    commentDraftOpen: tab === "code" && codeFillInputs.commentDraftOpen,
    reviewStepPending: tab === "code" && codeFillInputs.reviewStepPending,
  });
  const mergeTakesFill = fillHolder === "merge";

  const mergeFooter =
    detail?.state === "open" ? (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2.5">
        {mergeReadiness ? (
          <span className="text-[13px] font-medium">
            {mergeReadinessCountLabel(mergeReadiness)}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 basis-36 text-xs text-muted-foreground" aria-live="polite">
          {footerReason}
        </span>
        {showsMergeWhenReady ? (
          <Button
            variant="outline"
            disabled={actionPending}
            onClick={() =>
              autoMergeArmed
                ? void perform("disable-auto-merge")
                : setConfirmation({ open: true, action: "enable-auto-merge" })
            }
          >
            {pendingAction === "enable-auto-merge"
              ? "Turning on..."
              : pendingAction === "disable-auto-merge"
                ? "Cancelling..."
                : autoMergeArmed
                  ? "Cancel Merge when ready"
                  : "Merge when ready"}
          </Button>
        ) : null}
        <span className="inline-flex shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={mergeTakesFill ? "default" : "outline"}
                  disabled={!canMergeHere || actionPending}
                  className={cn(showsMergeMethods && "rounded-e-none")}
                  onClick={() => setConfirmation({ open: true, action: "merge" })}
                >
                  {mergeButtonLabel}
                </Button>
              }
            />
            <TooltipPopup side="top">
              {canMergeHere
                ? `${selectedMergeMethodLabel}${mergeShortcutLabel ? ` (${mergeShortcutLabel})` : ""}. ${hostName} decides whether it can go.`
                : (footerReason ?? selectedMergeMethodLabel)}
            </TooltipPopup>
          </Tooltip>
          {showsMergeMethods ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant={mergeTakesFill ? "default" : "outline"}
                    size="icon"
                    className="-ms-px rounded-s-none"
                    aria-label="Merge method"
                    disabled={!canMergeHere || actionPending}
                  />
                }
              >
                <ChevronDownIcon aria-hidden className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" side="top" className="min-w-56">
                <MenuRadioGroup
                  value={selectedMergeMethod}
                  onValueChange={(method) => {
                    const selectedMethod = method as PullRequestMergeMethod;
                    setMergeMethod(selectedMethod);
                    setLastSelectedMergeMethod(selectedMethod);
                  }}
                >
                  {allowedMergeMethods.map((method) => (
                    <MenuRadioItem key={method} value={method} closeOnClick>
                      <span className="flex min-w-0 items-center gap-2">
                        <PullRequestGlyph.merged className="size-3.5" />
                        <span>{PULL_REQUEST_MERGE_METHOD_LABELS[method]}</span>
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
          ) : null}
        </span>
      </div>
    ) : null;

  // The list already has the pull request's identity and summary. Keep them on screen
  // and let the richer detail read replace the remaining placeholders in place.
  if (detailQuery.isPending && !detail) {
    return (
      <PullRequestDetailGhost
        seed={matchingListEntry}
        summary={sharedSummary}
        number={reference.number}
        tabs={visibleTabs}
        activeTab={tab}
        {...(onBack ? { onBack } : {})}
        {...(onClose ? { onClose } : {})}
        actions={
          handoffSummary && checkoutControl ? (
            <TooltipProvider delay={150} closeDelay={150} timeout={400}>
              {checkoutControl}
            </TooltipProvider>
          ) : undefined
        }
      />
    );
  }

  const baseBranchLabel = detail ? (
    <span className="inline-flex min-w-0 items-center gap-1">
      {isStackedPullRequest ? (
        <PullRequestGlyph.stack aria-label="Stacked pull request" className="size-3 shrink-0" />
      ) : null}
      <code className="flex min-w-0">
        <MiddleTruncate value={detail.baseBranch} showTitle={false} />
      </code>
    </span>
  ) : null;

  return (
    <div ref={panelRef} className="relative flex h-full min-h-0 w-full flex-col bg-background">
      {threadPickerOpen && detail ? (
        <PullRequestThreadLinks
          key={`${environmentId}:${detail.url}`}
          display="picker"
          environmentId={environmentId}
          reference={reference}
          url={detail.url}
          threadRef={null}
          onPickerOpenChange={setThreadPickerOpen}
        />
      ) : null}
      {/* The header holds still: it never condenses on scroll, and Summary, Timeline and Code sit
          directly under it. */}
      <div
        className={cn(
          "@container/pr-header min-w-0 shrink-0",
          detail && "border-b border-border",
          !detail && !onClose && "hidden",
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5 pt-3 pr-3 pb-2.5 pl-4">
          {detail && statePresentation ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {titleDraft === null ? (
                <div className="group flex min-w-0 items-center gap-1">
                  {onBack ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-micro"
                            variant="ghost-muted"
                            onClick={onBack}
                            // A 24px hit area around the 20px button.
                            className="-ml-1.5 after:absolute after:-inset-0.5"
                            aria-label="Back to this thread's pull requests"
                          >
                            <ArrowLeftIcon aria-hidden className="size-3.5" />
                          </Button>
                        }
                      />
                      <TooltipPopup side="top">Back to pull requests</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <h2 className="min-w-0 flex-1 truncate text-lg leading-6 font-semibold tracking-[-0.015em]">
                          {detail.title}
                        </h2>
                      }
                    />
                    <TooltipPopup side="top">{detail.title}</TooltipPopup>
                  </Tooltip>
                  {canEditPullRequestChangeRequest(detail) ? (
                    <PullRequestEditButton
                      aria-label="Edit title"
                      onClick={() => setTitleScope({ pullRequestKey, text: detail.title })}
                    />
                  ) : null}
                </div>
              ) : (
                // A title is one line of text, not markdown, so it takes an input rather than
                // the editor the description and the remarks share.
                <div className="space-y-2">
                  <Input
                    autoFocus
                    size="sm"
                    disabled={titleSaving}
                    value={titleDraft}
                    aria-label="Pull request title"
                    onChange={(event) =>
                      setTitleScope({ pullRequestKey, text: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveTitle(titleDraft);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setTitleScope(null);
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={titleSaving}
                      onClick={() => setTitleScope(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={titleSaving || titleDraft.trim().length === 0}
                      onClick={() => void saveTitle(titleDraft)}
                    >
                      {titleSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              )}
              {/* State in a word, number, branches and age. */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="outline" className="shrink-0 text-muted-foreground">
                  <SettlingGlyph
                    icon={statePresentation.Icon}
                    moment={mergeMoment}
                    className="size-3"
                  />
                  {statePresentation.label}
                </Badge>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => void readLocalApi()?.shell.openExternal(detail.url)}
                        onContextMenu={(event) => openNumberContextMenu(event, detail)}
                        className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        aria-label={`Open pull request #${detail.number} on host`}
                      >
                        #{detail.number}
                      </button>
                    }
                  />
                  <TooltipPopup side="top">{openOnHostLabel(detail.provider)}</TooltipPopup>
                </Tooltip>
                <span className="flex min-w-0 max-w-full items-center gap-1 rounded bg-surface-well px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  <PullRequestCopyableCode
                    key={detail.headBranch}
                    value={detail.headBranch}
                    target="branch name"
                    copyLabel="Copy pull request branch"
                    copiedLabel="Branch name copied"
                    className="min-w-0"
                  />
                  <span aria-label="merges into" className="shrink-0 text-muted-foreground">
                    →
                  </span>
                  {/* An out-of-date base wears the warning on the branch name itself; pointing at
                      it opens the way out. */}
                  {freshness ? (
                    <PullRequestBaseFreshnessWarning
                      baseBranch={detail.baseBranch}
                      freshness={freshness}
                      pending={actionPending}
                      onUpdate={(method) => void perform("update-branch", undefined, method)}
                      className="min-w-0"
                    >
                      {baseBranchLabel}
                    </PullRequestBaseFreshnessWarning>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
                        {baseBranchLabel}
                      </TooltipTrigger>
                      <TooltipPopup side="top">
                        {isStackedPullRequest
                          ? `Stacked on ${detail.baseBranch}`
                          : detail.baseBranch}
                      </TooltipPopup>
                    </Tooltip>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  opened {formatRelativeTimeLabel(detail.createdAt)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex shrink-0 items-center justify-end gap-1">
            {detail ? (
              <TooltipProvider delay={150} closeDelay={150} timeout={400}>
                {!nativeStack && supportsStackActions && nativeStackQuery.error ? (
                  <Button variant="ghost" size="xs" onClick={nativeStackQuery.refresh}>
                    Retry stack lookup
                  </Button>
                ) : null}
                {nativeStack ? (
                  <PullRequestStackMenu
                    stack={nativeStack}
                    notice={nativeStackQuery.notice}
                    onRetry={nativeStackQuery.error ? nativeStackQuery.refresh : undefined}
                    reference={reference}
                    environmentId={environmentId}
                    onSelect={onSelectPullRequest}
                    mergeMethod={selectedMergeMethod}
                    canMerge={
                      nativeStackQuery.isFresh &&
                      supportsStackActions &&
                      can("merge") &&
                      allowedMergeMethods.length > 0
                    }
                    canRebase={
                      nativeStackQuery.isFresh &&
                      supportsStackActions &&
                      detail.viewerPermissions.stackRebase === true
                    }
                    onActed={() => {
                      refreshDetail();
                      onActed?.();
                    }}
                  />
                ) : null}
                {context === "page" ? (
                  <PullRequestThreadLinks
                    display="count"
                    environmentId={environmentId}
                    reference={reference}
                    url={detail.url}
                    threadRef={null}
                  />
                ) : null}
                {checkoutControl}
                <Menu>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <MenuTrigger
                          render={
                            <Button
                              aria-label={
                                refreshing ? "Refreshing pull request" : "More pull request actions"
                              }
                              className="sm:size-7"
                              size="icon-xs"
                              variant="ghost-muted"
                            />
                          }
                        >
                          {/* The refresh lives in this menu, so while one runs the trigger wears
                              the spinning glyph in place of the dots: the reader sees the panel
                              is fetching without a control appearing or the row shifting. */}
                          {refreshing ? (
                            <RefreshIcon refreshing className="size-4" />
                          ) : (
                            <MoreHorizontalIcon className="size-4" />
                          )}
                        </MenuTrigger>
                      }
                    />
                    <TooltipPopup>
                      {refreshing ? "Refreshing pull request" : "More pull request actions"}
                    </TooltipPopup>
                  </Tooltip>
                  <MenuPopup align="end" side="bottom" className="min-w-72">
                    <PullRequestThreadLinks
                      display="menu-item"
                      environmentId={environmentId}
                      reference={reference}
                      url={detail.url}
                      threadRef={
                        threadRef ??
                        (typeof composerDraftTarget === "object" ? composerDraftTarget : null)
                      }
                      onPickerOpenChange={setThreadPickerOpen}
                    />
                    <MenuItem disabled={refreshing} onClick={() => void refreshFromHost()}>
                      <RefreshIcon className="size-3.5" refreshing={refreshing} />
                      Refresh
                    </MenuItem>
                    <MenuItem disabled={handoff !== null} onClick={askAboutPullRequest}>
                      <MessageCircleQuestionIcon className="mt-1 size-3.5 shrink-0 self-start" />
                      <span className="flex min-w-0 flex-col">
                        <span>{handoff === "ask" ? "Opening..." : "Ask a question"}</span>
                        <span className="text-xs text-muted-foreground">
                          {attachTarget !== null
                            ? "Adds the pull request to this thread's composer."
                            : "Opens a thread that knows which pull request you mean."}
                        </span>
                      </span>
                    </MenuItem>
                    <MenuItem disabled={handoff !== null} onClick={explainPullRequest}>
                      <BookOpenIcon className="mt-1 size-3.5 shrink-0 self-start" />
                      <span className="flex min-w-0 flex-col">
                        <span>{handoff === "explain" ? "Opening..." : "Explain this PR"}</span>
                        <span className="text-xs text-muted-foreground">
                          A walk through the diff and what to read closely.
                        </span>
                      </span>
                    </MenuItem>
                    <MenuItem disabled={handoff !== null} onClick={reviewPullRequest}>
                      <FileSearchIcon className="mt-1 size-3.5 shrink-0 self-start" />
                      <span className="flex min-w-0 flex-col">
                        <span>{handoff === "review" ? "Opening..." : "Review this PR"}</span>
                        <span className="text-xs text-muted-foreground">
                          A prioritized review of the diff, ready to edit before sending.
                        </span>
                      </span>
                    </MenuItem>
                    <MenuItem disabled={handoff !== null} onClick={startFixFindings}>
                      <HammerIcon className="size-3.5" />
                      {handoff === "findings" ? "Preparing..." : handoffLabels.fixFindings}
                    </MenuItem>
                    {pickableEnvironments.length > 0 ? (
                      <ActOnEnvironmentPicker
                        environments={pickableEnvironments}
                        value={actingEnvironmentId}
                        onChange={(next) => setActingScope({ pullRequestKey, environmentId: next })}
                        disabled={handoff !== null}
                      />
                    ) : null}
                    <MenuSeparator />
                    {/* A next step: the card offers it when nothing comes before it, and here
                        while the card shows another step. */}
                    {showsWorkflowApproval && nextStep?.kind !== "approve-workflows" ? (
                      <MenuItem
                        disabled={actionPending}
                        onClick={() => setConfirmation({ open: true, action: "approve-workflows" })}
                      >
                        <PlayIcon className="size-3.5" />
                        {pendingAction === "approve-workflows"
                          ? "Approving..."
                          : "Approve workflows to run"}
                      </MenuItem>
                    ) : null}
                    {detail.state === "open" ? (
                      <>
                        {showsDraftToggle ? (
                          <MenuItem
                            disabled={actionPending}
                            onClick={() => void perform(detail.isDraft ? "ready" : "draft")}
                          >
                            {detail.isDraft ? (
                              <PullRequestGlyph.pullRequest className="size-3.5" />
                            ) : (
                              <PullRequestGlyph.draft className="size-3.5" />
                            )}
                            {detail.isDraft ? "Ready for review" : "Convert to draft"}
                          </MenuItem>
                        ) : null}
                        {/* The same merge, left with the host to carry out once its requirements
                            pass. A conflicting branch cannot be armed because nothing the host
                            waits for will clear the conflict. */}
                        {showsMergeWhenReady ? (
                          <MenuItem
                            disabled={actionPending}
                            onClick={() =>
                              autoMergeArmed
                                ? void perform("disable-auto-merge")
                                : setConfirmation({ open: true, action: "enable-auto-merge" })
                            }
                          >
                            <PullRequestGlyph.merged className="size-3.5" />
                            {autoMergeArmed ? "Cancel Merge when ready" : "Merge when ready"}
                          </MenuItem>
                        ) : null}
                        {/* A preference for the merge action rather than a second action, so it
                            is a radio group here instead of a chevron welded to the Merge pill.
                            Hidden while conflicting: every method would fail. */}
                        {/* Only where merging is on offer at all: a strategy to merge with is not
                            a choice for someone who may not merge. */}
                        {showsMergeMethods ? (
                          <>
                            {/* Only below the draft control. A host with no draft of its own, or
                                a draft whose control is already the header button, would leave
                                this against the separator that opened the group. */}
                            {showsDraftToggle || showsMergeWhenReady ? <MenuSeparator /> : null}
                            <MenuRadioGroup
                              value={selectedMergeMethod}
                              onValueChange={(method) => {
                                const selectedMethod = method as PullRequestMergeMethod;
                                setMergeMethod(selectedMethod);
                                setLastSelectedMergeMethod(selectedMethod);
                              }}
                            >
                              {allowedMergeMethods.map((method) => (
                                <MenuRadioItem
                                  key={method}
                                  value={method}
                                  disabled={actionPending}
                                  closeOnClick
                                >
                                  {/* The radio item lays its children out as one block, so the
                                      icon and the label need their own row to share a line. */}
                                  <span className="flex min-w-0 items-center gap-2">
                                    <PullRequestGlyph.merged className="size-3.5" />
                                    <span>{PULL_REQUEST_MERGE_METHOD_LABELS[method]}</span>
                                  </span>
                                </MenuRadioItem>
                              ))}
                            </MenuRadioGroup>
                          </>
                        ) : null}
                        {pullRequestActionMenuHasGroup(
                          showsDraftToggle,
                          showsMergeWhenReady,
                          showsMergeMethods,
                        ) ? (
                          <MenuSeparator />
                        ) : null}
                      </>
                    ) : null}
                    <MenuItem onClick={() => void readLocalApi()?.shell.openExternal(detail.url)}>
                      <ArrowUpRightIcon className="size-3.5" />
                      {openOnHostLabel(detail.provider)}
                    </MenuItem>
                    <MenuItem onClick={() => copyReference(detail.url, "PR link")}>
                      <LinkIcon className="size-3.5" />
                      Copy link
                      <MenuShortcut>
                        {shortcutLabelForCommand(keybindings, "thread.copyReference")}
                      </MenuShortcut>
                    </MenuItem>
                    <MenuItem onClick={() => copyReference(`#${reference.number}`, "PR number")}>
                      <CopyIcon className="size-3.5" />
                      Copy PR number
                      <MenuShortcut>
                        {shortcutLabelForCommand(keybindings, "pullRequest.copyNumber")}
                      </MenuShortcut>
                    </MenuItem>
                    {checkoutCommand ? (
                      <MenuItem onClick={() => copyReference(checkoutCommand, "Checkout command")}>
                        <GitBranchIcon className="size-3.5" />
                        Copy checkout command
                      </MenuItem>
                    ) : null}
                    {detail.state === "open" && can("close") ? (
                      <>
                        <MenuSeparator />
                        <MenuItem
                          variant="destructive"
                          disabled={actionPending}
                          onClick={() => setConfirmation({ open: true, action: "close" })}
                        >
                          <PullRequestGlyph.closed className="size-3.5" />
                          Close pull request
                        </MenuItem>
                      </>
                    ) : detail.state === "closed" && can("reopen") ? (
                      <>
                        <MenuSeparator />
                        <MenuItem disabled={actionPending} onClick={() => void perform("reopen")}>
                          <PullRequestGlyph.reopen className="size-3.5" />
                          Reopen pull request
                        </MenuItem>
                      </>
                    ) : detail.state === "merged" && can("revert") ? (
                      <>
                        <MenuSeparator />
                        <MenuItem
                          disabled={actionPending}
                          onClick={() => setConfirmation({ open: true, action: "revert" })}
                        >
                          <RotateCcwIcon className="size-3.5" />
                          Revert changes
                        </MenuItem>
                      </>
                    ) : null}
                  </MenuPopup>
                </Menu>
              </TooltipProvider>
            ) : null}
            {onClose ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Collapse pull request panel"
                onClick={onClose}
              >
                <PanelRightIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>

        {detail ? (
          <nav
            className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-2.5"
            aria-label="Pull request tabs"
          >
            <ToggleGroup
              className="shrink-0"
              size="segmented"
              variant="segmented"
              value={[tab]}
              onValueChange={(next) => {
                const nextTab = visibleTabs.find((item) => item.value === next[0])?.value;
                if (nextTab) setTab(nextTab);
              }}
            >
              {visibleTabs.map((item) => (
                <Toggle
                  key={item.value}
                  value={item.value}
                  onPointerEnter={item.value === "code" ? () => void loadCodeTab() : undefined}
                  onFocus={item.value === "code" ? () => void loadCodeTab() : undefined}
                >
                  {item.value === "code"
                    ? pullRequestCodeTabLabel(detail.changedFiles)
                    : item.label}
                </Toggle>
              ))}
            </ToggleGroup>
            {tab === "timeline" ? (
              <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <PullRequestMetaLine
                  className={cn(
                    "whitespace-nowrap text-[11px] transition-opacity",
                    (activityPending || activityError) && "opacity-35",
                  )}
                >
                  <span
                    className="inline-flex items-center gap-1"
                    aria-label={
                      activityError
                        ? "Comments unavailable"
                        : `${detail.commentCount.toLocaleString()} ${
                            detail.commentCount === 1 ? "comment" : "comments"
                          }`
                    }
                  >
                    <MessageSquareIcon aria-hidden className="size-3" />
                    {activityError
                      ? "—"
                      : activityPending
                        ? "…"
                        : detail.commentCount.toLocaleString()}
                  </span>
                  <span
                    className="inline-flex items-center gap-1"
                    aria-label={
                      activityError
                        ? "Commits unavailable"
                        : `${detail.commits.length.toLocaleString()} ${
                            detail.commits.length === 1 ? "commit" : "commits"
                          }`
                    }
                  >
                    <GitCommitHorizontalIcon aria-hidden className="size-3" />
                    {activityError
                      ? "—"
                      : activityPending
                        ? "…"
                        : detail.commits.length.toLocaleString()}
                  </span>
                  {approvalCount > 0 ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        pullRequestReviewOutcomeToneClassName("approved"),
                      )}
                    >
                      <PullRequestReviewOutcomeIcon outcome="approved" className="size-3" />
                      {approvalCount.toLocaleString()}
                      <span className="sr-only">
                        {approvalCount === 1 ? "approval" : "approvals"}
                      </span>
                    </span>
                  ) : null}
                </PullRequestMetaLine>
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-7 px-2 text-[10px] text-muted-foreground"
                  aria-label={
                    timelineOrder === "newest"
                      ? "Show oldest activity first"
                      : "Show newest activity first"
                  }
                  onClick={() =>
                    setTimelineOrder((value) => (value === "newest" ? "oldest" : "newest"))
                  }
                >
                  <ArrowDownUpIcon aria-hidden className="size-3" />
                  {timelineOrder === "newest" ? "Newest first" : "Oldest first"}
                </Button>
              </div>
            ) : null}
          </nav>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {detailQuery.error && !detail ? (
          <div className="overflow-y-auto p-4">
            <PanelErrorCard
              title="Could not load this pull request"
              reason={detailQuery.error}
              reassurance="Nothing on the host was changed."
              retrying={detailQuery.isPending}
              onRetry={refreshDetail}
              actions={
                unavailableGitHubUrl ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    render={
                      <a href={unavailableGitHubUrl} target="_blank" rel="noopener noreferrer" />
                    }
                  >
                    Open on GitHub
                  </Button>
                ) : null
              }
            />
          </div>
        ) : detail ? (
          <PullRequestMarkdownContext value={markdownContext}>
            {mountedTabs.has("summary") ? (
              <div className={cn("absolute inset-0", tab !== "summary" && "invisible")}>
                <PullRequestSummaryTab
                  environmentId={environmentId}
                  threadRef={threadRef}
                  reference={reference}
                  detail={detail}
                  activityPending={activityPending}
                  checksStale={checksStale}
                  activityError={activityError}
                  pendingFinding={handoff}
                  fixFindingLabel={handoffLabels.fixFinding}
                  onFixFinding={startFixFinding}
                  onRefresh={refreshDetail}
                  onRefreshChecks={refreshFromHost}
                  lead={
                    nextStep || mergeReadiness ? (
                      <div className="flex flex-col gap-[18px]">
                        {nextStep ? (
                          <PullRequestNextStepCard
                            step={nextStep}
                            pending={handoff !== null || actionPending}
                            onAction={runNextStepAction}
                            primaryOutline={fillHolder !== "next-step"}
                            renderAction={(action, primary) =>
                              action.kind === "request-review" ? (
                                <PullRequestReviewerPicker
                                  key={action.kind}
                                  environmentId={environmentId}
                                  reference={reference}
                                  allowed
                                  trigger={
                                    <Button variant={primary ? "default" : "outline"}>
                                      {action.label}
                                    </Button>
                                  }
                                />
                              ) : undefined
                            }
                          />
                        ) : null}
                        {mergeReadiness ? (
                          <PullRequestMergeReadinessChecklist
                            readiness={mergeReadiness}
                            ownReviewLine={ownReviewLine}
                            actions={{
                              "resolve-conflicts": (
                                <Button
                                  size="compact"
                                  variant="ghost"
                                  disabled={
                                    handoff !== null ||
                                    (attachTarget === null && checkoutRoot === null)
                                  }
                                  onClick={startResolveConflicts}
                                >
                                  {handoff === "conflicts" ? "Preparing..." : "Resolve"}
                                </Button>
                              ),
                              "update-branch":
                                freshness && freshness.methods.length > 0
                                  ? freshness.methods.map((method) => (
                                      <Button
                                        key={method}
                                        size="compact"
                                        variant="ghost"
                                        disabled={actionPending}
                                        onClick={() =>
                                          void perform("update-branch", undefined, method)
                                        }
                                      >
                                        {method === "rebase"
                                          ? "Update with rebase"
                                          : "Update branch"}
                                      </Button>
                                    ))
                                  : null,
                              "request-review":
                                detail.capabilities.reviewers.request &&
                                detail.capabilities.reviewers.listCandidates &&
                                detail.viewerPermissions.requestReviewers ? (
                                  <PullRequestReviewerPicker
                                    environmentId={environmentId}
                                    reference={reference}
                                    allowed
                                    trigger={
                                      <Button size="compact" variant="ghost">
                                        Request review
                                      </Button>
                                    }
                                  />
                                ) : null,
                            }}
                          />
                        ) : null}
                      </div>
                    ) : null
                  }
                />
              </div>
            ) : null}
            {mountedTabs.has("timeline") ? (
              <div className={cn("absolute inset-0", tab !== "timeline" && "invisible")}>
                {activityPending ? (
                  <PullRequestTimelineGhost />
                ) : activityError ? (
                  <PullRequestActivityUnavailableState
                    error={activityError}
                    onRetry={activityQuery.refresh}
                  />
                ) : (
                  <PullRequestTimelineTab
                    detail={detail}
                    environmentId={environmentId}
                    threadRef={threadRef}
                    reference={reference}
                    order={timelineOrder}
                    onOpenCommit={openCommit}
                    onRefresh={refreshDetail}
                  />
                )}
              </div>
            ) : null}
            {mountedTabs.has("code") ? (
              <div className={cn("absolute inset-0", tab !== "code" && "invisible")}>
                <Suspense fallback={<DiffPanelLoadingState label="Loading pull request diff..." />}>
                  <PullRequestCodeTab
                    onAddToAgentSelection={addSelectionToAgent}
                    environmentId={environmentId}
                    reference={reference}
                    detail={detail}
                    selectedCommitOid={selectedCodeCommitOid}
                    onSelectedCommitChange={selectCodeCommit}
                    pendingFinding={handoff}
                    fixFindingLabel={handoffLabels.fixFinding}
                    onFixFinding={startFixFinding}
                    onRefresh={refreshDetail}
                    refreshToken={codeRefreshToken}
                    composerHasText={composerHasText}
                    onFillInputsChange={setCodeFillInputs}
                  />
                </Suspense>
              </div>
            ) : null}
          </PullRequestMarkdownContext>
        ) : null}

        {/* Floats over the content, above the merge footer. */}
        {detail?.capabilities.comment && detail.viewerPermissions.comment ? (
          <div className="absolute right-4 bottom-3 z-20">
            <PullRequestCommentComposer
              key={JSON.stringify([
                environmentId,
                reference.projectId,
                reference.host,
                reference.repository,
                reference.number,
              ])}
              environmentId={environmentId}
              reference={reference}
              detail={detail}
              actionPending={actionPending}
              onCommentAction={performCommentAction}
              onCommented={refreshDetail}
            />
          </div>
        ) : null}
      </div>

      {/* One merge control, pinned under every sub-tab. */}
      {mergeFooter}

      <AlertDialog
        open={confirmation.open}
        onOpenChange={(open) => setConfirmation((current) => ({ ...current, open }))}
        onOpenChangeComplete={(open) => {
          if (!open) setConfirmation({ open: false, action: "merge" });
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "merge"
                ? "Merge pull request?"
                : confirmAction === "enable-auto-merge"
                  ? "Turn on Merge when ready?"
                  : confirmAction === "revert"
                    ? "Revert these changes?"
                    : confirmAction === "approve-workflows"
                      ? "Approve workflows to run?"
                      : "Close pull request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "merge"
                ? `This merges #${reference.number} using ${selectedMergeMethod}.`
                : confirmAction === "enable-auto-merge"
                  ? // The host merges this as soon as it considers the pull request ready, which
                    // may be immediately — there is no telling from here whether anything is
                    // still outstanding.
                    `This merges #${reference.number} using ${selectedMergeMethod} as soon as the host considers it ready, which may be immediately.`
                  : confirmAction === "revert"
                    ? `This opens a new pull request that reverses the changes merged by #${reference.number}.`
                    : confirmAction === "approve-workflows"
                      ? `This allows ${workflowApprovalsRequired} ${workflowApprovalsRequired === 1 ? "workflow" : "workflows"} from #${reference.number} to run. Review the code and workflow changes first.`
                      : `This closes #${reference.number} without merging it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              size="sm"
              variant={confirmAction === "close" ? "destructive" : "default"}
              disabled={actionPending}
              onClick={() => {
                const action = confirmAction;
                setConfirmation((current) => ({ ...current, open: false }));
                if (action === "merge") void perform("merge", selectedMergeMethod);
                if (action === "enable-auto-merge")
                  void perform("enable-auto-merge", selectedMergeMethod);
                if (action === "revert") void perform("revert");
                if (action === "approve-workflows") void perform("approve-workflows");
                if (action === "close") void perform("close");
              }}
            >
              {confirmAction === "merge"
                ? selectedMergeMethodLabel
                : confirmAction === "enable-auto-merge"
                  ? "Merge when ready"
                  : confirmAction === "revert"
                    ? "Create revert PR"
                    : confirmAction === "approve-workflows"
                      ? "Approve and run"
                      : "Close"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
