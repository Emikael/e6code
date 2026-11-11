import { useAtomValue } from "@effect/atom-react";
import type { FileDiffContentsLoader, FileDiffMetadata } from "@pierre/diffs";
import { useParams } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@e6tools/client-runtime/errors";
import { scopedThreadKey } from "@e6tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@e6tools/contracts";
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCodeViewFileReveal } from "./diffs/useCodeViewFileReveal";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { useFileContextMenuHandler } from "../fileContextMenu";
import { type DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { cn } from "~/lib/utils";
import {
  selectThreadDiffPanelSelection,
  useDiffPanelStore,
  type DiffPanelGitScope,
} from "../diffPanelStore";
import { derivePhase } from "../session-logic";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  fnv1a32,
  getDiffCollapseIconClassName,
  getDiffLineStat,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../lib/syntaxHighlighting";
import { areAllDiffFilesCollapsed } from "../lib/diffCollapse";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffFilePathCopyButton } from "./DiffFilePathCopyButton";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { DiffStat } from "./DiffStat";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { DiffChangesPanel, type DiffChangesSection } from "./diffs/DiffChangesPanel";
import { DIFF_FILE_RAIL_CLASS_NAME, DiffFileRail, DiffFileRailHeader } from "./diffs/DiffFileRail";
import {
  diffRailRows,
  FILE_RAIL_OPEN_MIN_WIDTH,
  isFileRailOpen,
  railFolderHints,
} from "./diffs/diffFileRail.logic";
import { DiffReviewToggle } from "./diffs/DiffReviewTick";
import { diffSinceReview } from "./diffs/diffSinceReview.logic";
import { DiffViewMenu } from "./diffs/DiffViewMenu";
import { diffReviewFingerprint, useDiffReviewView } from "../diffReviewStore";
import {
  diffPinState,
  newerChangeCount,
  pinnedDiffMessage,
  stillWorkingLabel,
} from "./diffs/diffPin.logic";
import { observeResize } from "~/lib/observeResize";
import { Button } from "./ui/button";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import { Switch } from "./ui/switch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  MenuCheckboxItem,
  MenuSeparator,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { buildBaseRefChoices, filterBaseRefChoices } from "../lib/baseRefChoices";
import { createGitDiffFileContentsLoader } from "../lib/diffFileContents";

import { useReviewFilePatches } from "./diffs/useReviewFilePatches";
import { DiffFileLoadingBoundary } from "./diffs/DiffFileLoadingBoundary";
import { DiffFileStatus } from "./diffs/DiffFileStatus";

type DiffThemeType = "light" | "dark";
const AUTOMATIC_BASE_REF = "__automatic_base_ref__";
// The file rail's open state on this device; absent until the user opens or hides it. A new key:
// the file tree it replaced stored false by default, which would hide the rail everywhere.
const DIFF_FILE_RAIL_STORAGE_KEY = "e6code.diffFileRailOpen:v2";
const DIFF_FILE_RAIL_STORAGE_SCHEMA = Schema.NullOr(Schema.Boolean);
const GIT_SCOPE_LABELS: Record<DiffPanelGitScope, string> = {
  uncommitted: "Uncommitted",
  staged: "Staged",
  unstaged: "Unstaged",
  branch: "Branch changes",
};
const SEGMENT_SELECTED_CLASS_NAME =
  "data-pressed:ring-1 data-pressed:ring-inset data-pressed:ring-primary-edge";
const GIT_SCOPE_SOURCE_KINDS = {
  uncommitted: "working-tree",
  staged: "staged",
  unstaged: "unstaged",
  branch: "branch-range",
} as const satisfies Record<DiffPanelGitScope, string>;
const fileEntryCache = new WeakMap<
  FileDiffMetadata,
  { fileDiff: FileDiffMetadata; fileKey: string; fileVersion: number }
>();

function getCachedFileEntry(fileDiff: FileDiffMetadata) {
  const cached = fileEntryCache.get(fileDiff);
  if (cached) return cached;
  const entry = {
    fileDiff,
    fileKey: buildFileDiffIdentityKey(fileDiff),
    fileVersion: buildFileDiffContentVersion(fileDiff),
  };
  fileEntryCache.set(fileDiff, entry);
  return entry;
}

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

const EMPTY_COLLAPSED_DIFF_FILE_KEYS: ReadonlySet<string> = new Set();

interface DiffPanelProps {
  mode?: DiffPanelMode;
  composerDraftTarget: ScopedThreadRef | DraftId;
  workspaceMutationId: string | null;
}

export default function DiffPanel({
  mode = "inline",
  composerDraftTarget,
  workspaceMutationId,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const diffLayout = settings.diffLayout;
  const updateClientSettings = useUpdateClientSettings();
  // Saved settings, not panel state: Wrap also drives file previews, so one choice holds everywhere.
  const wordWrap = settings.wordWrap;
  const diffIgnoreWhitespace = settings.diffIgnoreWhitespace;
  const [storedRailOpen, setRailOpen] = useLocalStorage(
    DIFF_FILE_RAIL_STORAGE_KEY,
    null,
    DIFF_FILE_RAIL_STORAGE_SCHEMA,
  );
  // Only crossing the open-by-default width matters, so a resize re-renders at most once.
  const [panelWidth, setPanelWidth] = useState(0);
  const railOpen = isFileRailOpen(storedRailOpen, panelWidth);
  const [railCurrentPath, setRailCurrentPath] = useState<string | null>(null);
  const [changedFileReveal, setChangedFileReveal] = useState<{
    readonly path: string;
    readonly section: DiffChangesSection;
    readonly id: number;
  } | null>(null);
  const handledChangedFileRevealRef = useRef(0);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const [codeViewRevision, setCodeViewRevision] = useState(0);
  // Files changed since review that show only their new changes, per scope.
  const [sinceReviewPaths, setSinceReviewPaths] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const [codeView, setCodeView] = useState<AnnotatableCodeViewHandle | null>(null);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useThread(routeThreadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useProject(
    activeThread && activeProjectId
      ? {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.workspaceRoot;
  const activeRepositoryRoot = activeThread?.worktreePath
    ? undefined
    : activeProject?.repositoryIdentity?.rootPath;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(activeThread?.environmentId ?? null),
  );
  const onFileContextMenu = useFileContextMenuHandler(activeThread?.environmentId ?? null);
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeThread?.environmentId ?? null,
    serverConfig?.availableEditors ?? [],
  );
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const gitStatusQuery = useEnvironmentQuery(
    activeThread !== null && activeThread !== undefined && activeCwd != null
      ? vcsEnvironment.status({
          environmentId: activeThread.environmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const diffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(state.byThreadKey, routeThreadRef),
  );
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  useEffect(() => {
    if (!routeThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      routeThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [diffSelection, orderedTurnDiffSummaries, routeThreadRef]);

  const selectedTurnId = diffSelection.kind === "turn" ? diffSelection.turnId : null;
  const selectedGitScope: DiffPanelGitScope =
    diffSelection.kind === "branch"
      ? "branch"
      : diffSelection.kind === "index"
        ? diffSelection.side
        : "uncommitted";
  const isWorkingTreeScope = selectedTurnId === null && selectedGitScope !== "branch";
  const workingTreeFiles = gitStatusQuery.data?.workingTree.files;
  // Older servers report files without index state; staging controls stay hidden there.
  const stagingSupported =
    workingTreeFiles !== undefined &&
    (workingTreeFiles.length === 0 ||
      workingTreeFiles.some((file) => file.staged !== undefined || file.unstaged !== undefined));
  // Working-tree scopes with staging list their files with stage controls and the commit box.
  const railHostsChanges = isWorkingTreeScope && stagingSupported && activeCwd != null;
  const agentRunning = derivePhase(activeThread?.session ?? null) === "running";
  const selectedBaseRef = diffSelection.kind === "branch" ? diffSelection.baseRef : null;
  const selectedFilePath = diffSelection.kind === "turn" ? diffSelection.filePath : null;
  const selectedFileRevealRequestId =
    diffSelection.kind === "turn" ? diffSelection.revealRequestId : 0;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const latestTurn = orderedTurnDiffSummaries[0];
  const selectedScopeLabel =
    selectedTurnId === null
      ? GIT_SCOPE_LABELS[selectedGitScope]
      : selectedTurn?.turnId === latestTurn?.turnId
        ? "Latest turn"
        : `Turn ${selectedCheckpointTurnCount ?? "?"}`;
  const reviewSectionId = selectedTurn ? `turn:${selectedTurn.turnId}` : selectedGitScope;
  const collapseScopeKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}:${reviewSectionId}`
    : null;
  const codeViewMountKey = `${collapseScopeKey ?? reviewSectionId}:${codeViewRevision}`;
  const reviewSectionTitle = selectedTurn
    ? `Turn ${selectedCheckpointTurnCount ?? "?"}`
    : GIT_SCOPE_LABELS[selectedGitScope];
  const includeIndexSplit = selectedGitScope === "staged" || selectedGitScope === "unstaged";
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const activeCheckpointDiff = useCheckpointDiff(
    {
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: selectedCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: selectedCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : null,
    },
    { enabled: isGitRepo && selectedTurn !== undefined },
  );
  const primaryBranchDiffPreview = useEnvironmentQuery(
    selectedTurnId === null && activeThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
            ...(includeIndexSplit ? { includeIndexSplit: true } : {}),
          },
        })
      : null,
  );
  const shouldRetryBranchDiffAtEnvironmentCwd =
    selectedTurnId === null &&
    primaryBranchDiffPreview.error?.includes("configured workspace root") === true &&
    serverConfig?.cwd !== undefined &&
    serverConfig.cwd !== activeCwd;
  const fallbackBranchDiffPreview = useEnvironmentQuery(
    shouldRetryBranchDiffAtEnvironmentCwd && activeThread && serverConfig
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: serverConfig.cwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
            ...(includeIndexSplit ? { includeIndexSplit: true } : {}),
          },
        })
      : null,
  );
  const branchDiffPreview = shouldRetryBranchDiffAtEnvironmentCwd
    ? fallbackBranchDiffPreview
    : primaryBranchDiffPreview;
  const canRefreshGitDiff =
    isGitRepo && selectedTurnId === null && activeThread != null && activeCwd != null;
  const activeThreadRefreshKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}`
    : null;

  // While the agent works the diff holds still: the preview last applied stays on screen and a
  // newer one waits behind Update. The pin belongs to one query; another scope starts afresh.
  const livePreview = branchDiffPreview.data;
  const previewKey = `${activeThreadRefreshKey ?? ""}:${selectedGitScope}:${selectedBaseRef ?? ""}:${diffIgnoreWhitespace}`;
  const [appliedPreview, setAppliedPreview] = useState<{
    readonly key: string;
    readonly data: NonNullable<typeof livePreview>;
    /** The working tree as it was with this preview, so the changes rail holds still too. */
    readonly workingTree: typeof workingTreeFiles;
  } | null>(null);
  const appliedPreviewForScope = appliedPreview?.key === previewKey ? appliedPreview.data : null;
  // The pin holds back the agent's changes only. After the user's own stage, commit or refresh,
  // the diff follows the live one until the preview that answers it arrives.
  const [followLive, setFollowLive] = useState<{ readonly since: typeof livePreview } | null>(null);
  const markUserChange = useCallback(() => setFollowLive({ since: livePreview }), [livePreview]);
  const sourceOfPreview = (preview: typeof livePreview | null) =>
    preview?.sources.find((source) => source.kind === GIT_SCOPE_SOURCE_KINDS[selectedGitScope]);
  const liveGitSource = sourceOfPreview(livePreview);
  const appliedGitSource = sourceOfPreview(appliedPreviewForScope);
  const pinState =
    selectedTurnId === null && followLive === null
      ? diffPinState({
          agentRunning,
          appliedRevision: appliedGitSource?.diffHash ?? null,
          liveRevision: liveGitSource?.diffHash ?? null,
        })
      : "live";
  if (
    pinState === "live" &&
    livePreview &&
    (appliedPreview?.data !== livePreview ||
      appliedPreview.key !== previewKey ||
      appliedPreview.workingTree !== workingTreeFiles)
  ) {
    setAppliedPreview({ key: previewKey, data: livePreview, workingTree: workingTreeFiles });
  }
  if (followLive !== null && livePreview && livePreview !== followLive.since) {
    setFollowLive(null);
  }
  const shownPreview = pinState === "pinned" ? appliedPreviewForScope : livePreview;
  const pinnedChangeCount =
    pinState === "pinned" && liveGitSource
      ? newerChangeCount(appliedGitSource?.files, liveGitSource.files)
      : null;
  const showPinnedBanner = pinState === "pinned";
  // While pinned, the changes rail lists the working tree the shown diff was taken from.
  const shownWorkingTreeFiles =
    pinState === "pinned" && appliedPreview?.key === previewKey
      ? appliedPreview.workingTree
      : workingTreeFiles;
  const diffBodyRef = useRef<HTMLDivElement | null>(null);
  const applyNewestDiff = () => {
    if (livePreview) {
      setAppliedPreview({ key: previewKey, data: livePreview, workingTree: workingTreeFiles });
    }
    // Update leaves with the banner; the reader goes on in the diff.
    diffBodyRef.current?.focus();
  };

  const selectedGitSource = sourceOfPreview(shownPreview);
  const refreshPreviewQuery = branchDiffPreview.refresh;
  const refreshDiffFromUserAction = () => {
    markUserChange();
    refreshPreviewQuery();
  };

  const currentLoadDiffFiles = useMemo<FileDiffContentsLoader | undefined>(() => {
    const preview = shownPreview;
    if (selectedTurnId !== null || !activeThread || !preview || !selectedGitSource) {
      return undefined;
    }

    return createGitDiffFileContentsLoader(getDiffFileContents, {
      environmentId: activeThread.environmentId,
      cwd: preview.cwd,
      sourceKind: selectedGitSource.kind,
      baseRef: selectedGitSource.baseRef,
      headRef: selectedGitSource.headRef,
      cacheKey: selectedGitSource.diffHash,
    });
  }, [activeThread, shownPreview, getDiffFileContents, selectedGitSource, selectedTurnId]);
  const loadDiffFilesRef = useRef(currentLoadDiffFiles);
  loadDiffFilesRef.current = currentLoadDiffFiles;
  const loadDiffFiles = useCallback<FileDiffContentsLoader>(async (fileDiff) => {
    const loader = loadDiffFilesRef.current;
    if (!loader) throw new Error("Diff file contents are unavailable for this selection.");
    return loader(fileDiff);
  }, []);
  const localBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const baseRefChoices = buildBaseRefChoices(
    localBranchRefs.data?.refs.filter((ref) => ref.name !== selectedGitSource?.headRef) ?? [],
    remoteBranchRefs.data?.refs ?? [],
  );
  const matchingBaseRefChoices = filterBaseRefChoices(baseRefChoices, baseRefQuery);
  const valueForBaseRefChoice = (choice: (typeof baseRefChoices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const baseRefItems = [AUTOMATIC_BASE_REF, ...baseRefChoices.map(valueForBaseRefChoice)];
  const filteredBaseRefItems = [
    ...(baseRefQuery.trim().length === 0 ? [AUTOMATIC_BASE_REF] : []),
    ...matchingBaseRefChoices.map(valueForBaseRefChoice),
  ];
  const gitDiff = selectedGitSource?.diff;

  const selectedPatch = selectedTurn ? activeCheckpointDiff.data?.diff : gitDiff;
  const isSelectedPatchTruncated = !selectedTurn && selectedGitSource?.truncated === true;
  const isLoadingSelectedPatch = selectedTurn
    ? activeCheckpointDiff.isPending
    : branchDiffPreview.isPending;
  const selectedPatchError = selectedTurn ? activeCheckpointDiff.error : branchDiffPreview.error;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const lazySource =
    !selectedTurn && selectedGitSource?.truncated && selectedGitSource.files
      ? selectedGitSource
      : null;
  const renderablePatch = useMemo(
    () =>
      lazySource
        ? null
        : getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
            compactPartialHunkOffsets: selectedTurnId === null,
          }),
    [lazySource, resolvedTheme, selectedPatch, selectedTurnId],
  );
  const fileStats = useMemo(
    () => new Map(lazySource?.files?.map((file) => [file.path, file])),
    [lazySource?.files],
  );
  const {
    scope: filePatchScope,
    isPending: areFilePatchesPending,
    fileStates,
    retry,
    requestFile,
    readyFilePaths,
    renderableFiles,
    settledFileCount,
    loadNextFiles,
  } = useReviewFilePatches({
    environmentId: activeThread?.environmentId,
    cwd: shownPreview?.cwd,
    source: lazySource,
    baseRef: lazySource?.baseRef ?? selectedBaseRef,
    ignoreWhitespace: diffIgnoreWhitespace,
    theme: resolvedTheme,
    revision: shownPreview ? DateTime.formatIso(shownPreview.generatedAt) : undefined,
    preview: renderablePatch,
  });
  const refreshBranchDiffPreview = refreshPreviewQuery;

  useEffect(() => {
    if (!canRefreshGitDiff) return;
    const refreshOnFocus = () => refreshBranchDiffPreview();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [canRefreshGitDiff, refreshBranchDiffPreview]);

  // Staging, discards, commits, and terminal edits all land in the status stream first;
  // follow it so the diff never shows a stale index.
  const workingTreeSignature = useMemo(
    () =>
      workingTreeFiles
        ?.map(
          (file) =>
            `${file.path}\0${file.staged ?? ""}\0${file.unstaged ?? ""}\0${file.insertions}\0${file.deletions}`,
        )
        .join("\n"),
    [workingTreeFiles],
  );
  const previousWorkingTreeSignatureRef = useRef(workingTreeSignature);
  useEffect(() => {
    const previous = previousWorkingTreeSignatureRef.current;
    previousWorkingTreeSignatureRef.current = workingTreeSignature;
    if (!canRefreshGitDiff || previous === undefined || previous === workingTreeSignature) return;
    refreshBranchDiffPreview();
  }, [canRefreshGitDiff, refreshBranchDiffPreview, workingTreeSignature]);

  useWorkspaceMutationRefresh({
    enabled: canRefreshGitDiff,
    mutationId: workspaceMutationId,
    refresh: refreshBranchDiffPreview,
    resourceKey: `diff:${activeThreadRefreshKey ?? ""}`,
  });

  const isRefreshingDiff = branchDiffPreview.isPending || areFilePatchesPending;
  const renderableFileEntries = useMemo(
    () => renderableFiles.map(getCachedFileEntry),
    [renderableFiles],
  );
  const defaultCollapsedDiffFileKeys = useMemo(
    () =>
      settings.diffFilesCollapsed
        ? new Set(renderableFileEntries.map((file) => file.fileKey))
        : EMPTY_COLLAPSED_DIFF_FILE_KEYS,
    [renderableFileEntries, settings.diffFilesCollapsed],
  );
  const collapsedDiffFileKeys =
    collapsedDiffFiles.scopeKey === collapseScopeKey
      ? collapsedDiffFiles.fileKeys
      : defaultCollapsedDiffFileKeys;
  const renderLoadingBoundary = useCallback(
    () =>
      settledFileCount < renderableFiles.length ? (
        <DiffFileLoadingBoundary
          load={loadNextFiles}
          count={renderableFiles.length - settledFileCount}
        />
      ) : null,
    [settledFileCount, renderableFiles.length, loadNextFiles],
  );
  const diffFileKeys = useMemo(
    () => renderableFileEntries.map((file) => file.fileKey),
    [renderableFileEntries],
  );
  const allDiffFilesCollapsed = areAllDiffFilesCollapsed(diffFileKeys, collapsedDiffFileKeys);
  const noDiffFilesCollapsed = !diffFileKeys.some((fileKey) => collapsedDiffFileKeys.has(fileKey));
  const diffLineStat = useMemo(() => {
    if (!selectedTurn && selectedGitSource?.files) {
      return selectedGitSource.files.reduce(
        (total, file) => ({
          additions: total.additions + file.additions,
          deletions: total.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      );
    }
    return getDiffLineStat(renderableFiles);
  }, [renderableFiles, selectedGitSource, selectedTurn]);
  // In the body's order, so the rail and the diff read the same way down.
  // Folder hints depend on the paths alone, so patches loading in batches do not redo them.
  const railPathsKey = renderableFiles.map(resolveFileDiffPath).join("\u0000");
  const railHints = useMemo(
    () => railFolderHints(railPathsKey === "" ? [] : railPathsKey.split("\u0000")),
    [railPathsKey],
  );
  const railRows = useMemo(
    () =>
      diffRailRows(
        renderableFiles.map((fileDiff) => {
          const path = resolveFileDiffPath(fileDiff);
          const stat = fileStats.get(path) ?? getDiffLineStat([fileDiff]);
          return { path, additions: stat.additions, deletions: stat.deletions };
        }),
        railHints,
      ),
    [fileStats, railHints, renderableFiles],
  );
  const railPaths = useMemo(() => railRows.map((row) => row.path), [railRows]);
  const railRowsReady = renderablePatch !== null || lazySource !== null || !isLoadingSelectedPatch;
  // Review marks: per thread and scope, keyed by what each file looks like now.
  // Uncommitted compares against HEAD, as `git status` counts do, so its marks also keep those
  // counts and Run details can check them whatever the whitespace setting.
  const rawCountsByPath = useMemo(
    () =>
      selectedTurnId === null && selectedGitScope === "uncommitted"
        ? new Map(
            shownWorkingTreeFiles?.map((file) => [
              file.path,
              { additions: file.insertions, deletions: file.deletions },
            ]),
          )
        : null,
    [selectedGitScope, selectedTurnId, shownWorkingTreeFiles],
  );
  const reviewFiles = useMemo(
    () =>
      renderableFiles.map((fileDiff, index) => {
        const row = railRows[index]!;
        return {
          path: row.path,
          fingerprint: diffReviewFingerprint({
            fileDiff: fileDiff.cacheKey?.endsWith(":pending") === true ? null : fileDiff,
            additions: row.additions,
            deletions: row.deletions,
            ignoreWhitespace: diffIgnoreWhitespace,
            rawCounts: rawCountsByPath?.get(row.path) ?? null,
          }),
        };
      }),
    [diffIgnoreWhitespace, railRows, rawCountsByPath, renderableFiles],
  );
  const review = useDiffReviewView({
    threadKey: routeThreadRef ? scopedThreadKey(routeThreadRef) : null,
    scope: reviewSectionId,
    files: reviewFiles,
  });
  // For a file the agent changed again since it was reviewed: the file with only its new changes.
  const reviewedHunksOf = review.reviewedHunksOf;
  const sinceReview = useMemo(() => {
    const offers = new Map<string, ReturnType<typeof diffSinceReview>>();
    for (const fileDiff of renderableFiles) {
      if (fileDiff.cacheKey?.endsWith(":pending") === true) continue;
      const path = resolveFileDiffPath(fileDiff);
      const hunks = reviewedHunksOf(path);
      if (!hunks) continue;
      const offer = diffSinceReview(fileDiff, hunks);
      if (offer) offers.set(path, offer);
    }
    return offers;
  }, [renderableFiles, reviewedHunksOf]);
  const showingSinceReview =
    sinceReviewPaths.scopeKey === collapseScopeKey
      ? sinceReviewPaths.fileKeys
      : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
  const toggleSinceReview = useCallback(
    (path: string) => {
      setSinceReviewPaths((current) => {
        const next = new Set(
          current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS,
        );
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey],
  );
  const codeViewFiles = useMemo(
    () =>
      renderableFileEntries
        .filter(({ fileDiff }) => !lazySource || readyFilePaths.has(resolveFileDiffPath(fileDiff)))
        .map(({ fileDiff, fileKey, fileVersion }) => {
          const filePath = resolveFileDiffPath(fileDiff);
          const narrowed = showingSinceReview.has(filePath) ? sinceReview.get(filePath) : null;
          return {
            fileDiff: narrowed?.fileDiff ?? fileDiff,
            filePath,
            fileKey,
            fileVersion: narrowed ? fnv1a32(`${fileVersion}:since-review`) : fileVersion,
            // Header-only placeholders use the viewer's collapsed geometry until their patch arrives.
            collapsed:
              collapsedDiffFileKeys.has(fileKey) ||
              fileDiff.cacheKey?.endsWith(":pending") === true,
          };
        }),
    [
      collapsedDiffFileKeys,
      renderableFileEntries,
      lazySource,
      readyFilePaths,
      showingSinceReview,
      sinceReview,
    ],
  );
  const selectedDiffFileKey = selectedFilePath
    ? (codeViewFiles.find((candidate) => candidate.filePath === selectedFilePath)?.fileKey ?? null)
    : null;

  useEffect(() => {
    if (!selectedDiffFileKey || !codeView?.getInstance()) return;
    codeView.scrollTo({ type: "item", id: selectedDiffFileKey, align: "start" });
  }, [codeView, codeViewMountKey, selectedDiffFileKey, selectedFileRevealRequestId]);

  const treeRevealScope = useMemo(
    () => ({ collapseScopeKey, diffSelection }),
    [collapseScopeKey, diffSelection],
  );
  const requestTreeReveal = useCodeViewFileReveal(
    codeView,
    treeRevealScope,
    codeViewFiles.map((file) => file.fileKey),
  );
  const revealDiffFile = useCallback(
    (filePath: string) => {
      const index = renderableFileEntries.findIndex(
        (candidate) => resolveFileDiffPath(candidate.fileDiff) === filePath,
      );
      const file = renderableFileEntries[index];
      if (!file) return;
      setCollapsedDiffFiles((current) => {
        const next = new Set(
          current.scopeKey === collapseScopeKey ? current.fileKeys : defaultCollapsedDiffFileKeys,
        );
        next.delete(file.fileKey);
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
      if (lazySource && index >= settledFileCount) {
        requestFile(index);
      }
      requestTreeReveal(file.fileKey);
    },
    [
      renderableFileEntries,
      collapseScopeKey,
      defaultCollapsedDiffFileKeys,
      requestTreeReveal,
      lazySource,
      settledFileCount,
      requestFile,
    ],
  );

  const externalRevealRef = useRef<{ cache: string; key: string } | null>(null);
  useEffect(() => {
    if (!lazySource || !selectedFilePath) return;
    const key = `${selectedFilePath}:${selectedFileRevealRequestId}`;
    if (
      externalRevealRef.current?.cache === filePatchScope &&
      externalRevealRef.current.key === key
    )
      return;
    externalRevealRef.current = { cache: filePatchScope, key };
    revealDiffFile(selectedFilePath);
  }, [lazySource, selectedFilePath, selectedFileRevealRequestId, filePatchScope, revealDiffFile]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd,
        repositoryRoot: activeRepositoryRoot,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(routeThreadRef
                  ? {
                      environmentId: routeThreadRef.environmentId,
                      threadId: routeThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, activeRepositoryRoot, openInPreferredEditor, routeThreadRef],
  );
  const toggleDiffFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => {
        const next = new Set(
          current.scopeKey === collapseScopeKey ? current.fileKeys : defaultCollapsedDiffFileKeys,
        );
        if (next.has(fileKey)) {
          next.delete(fileKey);
        } else {
          next.add(fileKey);
        }
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey, defaultCollapsedDiffFileKeys],
  );

  // Marking a file reviewed folds it, so the next one comes up; unmarking leaves it as it is.
  const setReviewViewed = review.setViewed;
  const setFileReviewed = useCallback(
    (filePath: string, reviewed: boolean) => {
      setReviewViewed(filePath, reviewed);
      if (!reviewed) return;
      const file = renderableFileEntries.find(
        (candidate) => resolveFileDiffPath(candidate.fileDiff) === filePath,
      );
      if (!file) return;
      setCollapsedDiffFiles((current) => {
        const next = new Set(
          current.scopeKey === collapseScopeKey ? current.fileKeys : defaultCollapsedDiffFileKeys,
        );
        next.add(file.fileKey);
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey, defaultCollapsedDiffFileKeys, renderableFileEntries, setReviewViewed],
  );

  const setAllDiffFilesCollapsed = useCallback(
    (collapsed: boolean) => {
      setCodeViewRevision((current) => current + 1);
      setCollapsedDiffFiles({
        scopeKey: collapseScopeKey,
        fileKeys: collapsed ? new Set(diffFileKeys) : EMPTY_COLLAPSED_DIFF_FILE_KEYS,
      });
    },
    [collapseScopeKey, diffFileKeys],
  );

  const selectTurn = (turnId: TurnId) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectTurn(routeThreadRef, turnId);
  };
  const selectGitScope = (scope: DiffPanelGitScope) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectGitScope(routeThreadRef, scope);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectBranchBaseRef(routeThreadRef, baseRef);
  };

  const selectChangedFile = useCallback(
    (filePath: string, section: DiffChangesSection) => {
      setChangedFileReveal((current) => ({
        path: filePath,
        section,
        id: (current?.id ?? 0) + 1,
      }));
      const inCurrentDiff = renderableFileEntries.some(
        (candidate) => resolveFileDiffPath(candidate.fileDiff) === filePath,
      );
      // "Uncommitted" shows both sections; otherwise jump to the side the row came from.
      if (!inCurrentDiff && selectedGitScope !== "uncommitted" && selectedGitScope !== section) {
        selectGitScope(section);
      }
    },
    [renderableFileEntries, selectGitScope, selectedGitScope],
  );
  // Run details asks to land on a working-tree file or on the commit box; handle it once.
  const focusRequest = useDiffPanelStore((state) =>
    routeThreadRef
      ? (state.focusRequestByThreadKey[scopedThreadKey(routeThreadRef)] ?? null)
      : null,
  );
  const [commitFocusRequest, setCommitFocusRequest] = useState(0);
  // Each request focuses the commit box once, however often the changes panel remounts.
  const handledCommitFocusRequestRef = useRef(0);
  const consumeCommitFocusRequest = useCallback(() => {
    if (handledCommitFocusRequestRef.current === commitFocusRequest) return false;
    handledCommitFocusRequestRef.current = commitFocusRequest;
    return true;
  }, [commitFocusRequest]);
  useEffect(() => {
    if (!focusRequest || !routeThreadRef) return;
    useDiffPanelStore.getState().consumeFocusRequest(routeThreadRef);
    if (focusRequest.kind === "commit") {
      setRailOpen(true);
      setCommitFocusRequest((current) => current + 1);
      return;
    }
    const file = workingTreeFiles?.find((candidate) => candidate.path === focusRequest.path);
    selectChangedFile(
      focusRequest.path,
      file?.staged !== undefined && file.unstaged === undefined ? "staged" : "unstaged",
    );
  }, [focusRequest, routeThreadRef, selectChangedFile, setRailOpen, workingTreeFiles]);

  // Reveal once per click, as soon as the file is in the diff (possibly after a scope switch).
  useEffect(() => {
    if (!changedFileReveal || handledChangedFileRevealRef.current === changedFileReveal.id) return;
    if (
      renderableFileEntries.some(
        (candidate) => resolveFileDiffPath(candidate.fileDiff) === changedFileReveal.path,
      )
    ) {
      handledChangedFileRevealRef.current = changedFileReveal.id;
      revealDiffFile(changedFileReveal.path);
    }
  }, [changedFileReveal, renderableFileEntries, revealDiffFile]);

  const selectRailFile = useCallback(
    (filePath: string) => {
      setRailCurrentPath(filePath);
      revealDiffFile(filePath);
    },
    [revealDiffFile],
  );
  const attachDiffBody = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    return observeResize(element, (entries) => {
      const width = entries.at(-1)?.contentRect.width ?? 0;
      setPanelWidth((current) =>
        current >= FILE_RAIL_OPEN_MIN_WIDTH === width >= FILE_RAIL_OPEN_MIN_WIDTH ? current : width,
      );
    });
  }, []);

  const headerRow = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
        <span className="shrink-0 text-xs text-muted-foreground">Showing</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="compact"
                variant="outline"
                className="min-w-0 max-w-full"
                aria-label={`Diff scope: ${selectedScopeLabel}`}
              />
            }
          >
            <span className="truncate">{selectedScopeLabel}</span>
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {(
              [
                "uncommitted",
                ...(stagingSupported ? (["staged", "unstaged"] as const) : []),
              ] as const
            ).map((scope) => (
              <DropdownMenuItem
                key={scope}
                className={
                  selectedTurnId === null && selectedGitScope === scope
                    ? "bg-foreground/[0.08]"
                    : undefined
                }
                onClick={() => selectGitScope(scope)}
              >
                <span>{GIT_SCOPE_LABELS[scope]}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "branch"
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => selectGitScope("branch")}
            >
              <span>Branch changes</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={
                selectedTurnId !== null && selectedTurn?.turnId === latestTurn?.turnId
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => {
                if (latestTurn) selectTurn(latestTurn.turnId);
              }}
            >
              <span>Latest turn</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Turn</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {orderedTurnDiffSummaries.map((summary) => {
                  const turnCount =
                    summary.checkpointTurnCount ??
                    inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                    "?";
                  return (
                    <DropdownMenuItem
                      key={summary.turnId}
                      className={
                        summary.turnId === selectedTurn?.turnId ? "bg-foreground/[0.08]" : undefined
                      }
                      onClick={() => selectTurn(summary.turnId)}
                    >
                      <span>Turn {turnCount}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedTurnId === null && selectedGitScope === "branch" && selectedGitSource?.baseRef && (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
            aria-label={`Comparing ${selectedGitSource.headRef ?? "HEAD"} against ${selectedGitSource.baseRef}`}
          >
            <Tooltip>
              <TooltipTrigger render={<span className="flex min-w-0 items-center gap-2" />}>
                <span className="min-w-0 max-w-48 truncate">
                  {selectedGitSource.headRef ?? "HEAD"}
                </span>
                <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {`${selectedGitSource.headRef ?? "HEAD"} → ${selectedGitSource.baseRef}`}
              </TooltipPopup>
            </Tooltip>
            <Combobox
              items={baseRefItems}
              filteredItems={filteredBaseRefItems}
              value={selectedBaseRef ?? AUTOMATIC_BASE_REF}
              onOpenChange={(open) => {
                if (!open) setBaseRefQuery("");
              }}
              onValueChange={(value) => {
                if (!value) return;
                selectBranchBaseRef(value === AUTOMATIC_BASE_REF ? null : value);
              }}
            >
              <ComboboxTrigger
                className="inline-flex min-w-0 max-w-48 items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Change comparison target. Currently ${selectedGitSource.baseRef}`}
              >
                <span className="min-w-0 truncate">{selectedGitSource.baseRef}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
              </ComboboxTrigger>
              <ComboboxPopup
                align="start"
                className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden"
              >
                <ComboboxSearchInput
                  placeholder="Search refs..."
                  value={baseRefQuery}
                  onChange={(event) => setBaseRefQuery(event.target.value)}
                />
                <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  <span aria-hidden="true" />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
                    <span>Branch</span>
                    <span className="text-right">Remote</span>
                  </div>
                </div>
                <ComboboxEmpty>No matching refs.</ComboboxEmpty>
                <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
                  <ComboboxItem
                    className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                    contentClassName="w-full min-w-0 overflow-hidden"
                    value={AUTOMATIC_BASE_REF}
                  >
                    <span className="block min-w-0 truncate">Automatic</span>
                  </ComboboxItem>
                  {baseRefChoices.map((choice) => {
                    const item = valueForBaseRefChoice(choice);
                    const hasBoth = choice.local !== null && choice.remote !== null;
                    const useRemote = choice.remote?.name === item;
                    return (
                      <ComboboxItem
                        key={choice.id}
                        className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                        contentClassName="w-full min-w-0 overflow-hidden"
                        value={item}
                      >
                        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center overflow-hidden">
                          <span className="block min-w-0 truncate pe-2">{choice.label}</span>
                          {hasBoth ? (
                            <div
                              className="flex justify-end"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <Switch
                                aria-label={`Use remote version of ${choice.label}`}
                                checked={useRemote}
                                className="[--thumb-size:--spacing(3)]"
                                onCheckedChange={(checked) => {
                                  const nextRef = checked
                                    ? choice.remote?.name
                                    : choice.local?.name;
                                  if (nextRef) selectBranchBaseRef(nextRef);
                                }}
                              />
                            </div>
                          ) : choice.remote ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="flex justify-end text-muted-foreground">
                                    <CheckIcon
                                      role="img"
                                      aria-label="Remote only"
                                      className="size-3"
                                    />
                                  </span>
                                }
                              />
                              <TooltipPopup side="top">Remote only</TooltipPopup>
                            </Tooltip>
                          ) : null}
                        </div>
                      </ComboboxItem>
                    );
                  })}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
          </div>
        )}
        {codeViewFiles.length > 0 || (!selectedTurn && selectedGitSource?.files?.length) ? (
          <DiffStat
            tone="neutral"
            additions={diffLineStat.additions}
            deletions={diffLineStat.deletions}
            className="shrink-0 text-[11px] text-muted-foreground"
          />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
        <ToggleGroup
          aria-label="Diff layout"
          className="shrink-0"
          variant="segmented"
          value={[diffLayout]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "stacked" || next === "split") {
              updateClientSettings({ diffLayout: next });
            }
          }}
        >
          {/* The chosen segment takes the selected edge; a fill change alone is too faint. */}
          <Toggle value="stacked" className={SEGMENT_SELECTED_CLASS_NAME}>
            Stacked
          </Toggle>
          <Toggle value="split" className={SEGMENT_SELECTED_CLASS_NAME}>
            Split
          </Toggle>
        </ToggleGroup>
        <DiffViewMenu
          wordWrap={wordWrap}
          onWordWrapChange={(next) => updateClientSettings({ wordWrap: next })}
          ignoreWhitespace={diffIgnoreWhitespace}
          onIgnoreWhitespaceChange={(next) => updateClientSettings({ diffIgnoreWhitespace: next })}
          fileCount={diffFileKeys.length}
          allCollapsed={allDiffFilesCollapsed}
          noneCollapsed={noDiffFilesCollapsed}
          onExpandAll={() => setAllDiffFilesCollapsed(false)}
          onCollapseAll={() => setAllDiffFilesCollapsed(true)}
          onRefresh={canRefreshGitDiff ? refreshDiffFromUserAction : undefined}
          refreshing={isRefreshingDiff}
        >
          <MenuSeparator />
          <MenuCheckboxItem
            checked={railOpen}
            onCheckedChange={(checked) => setRailOpen(Boolean(checked))}
          >
            File list
          </MenuCheckboxItem>
        </DiffViewMenu>
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : selectedTurnId !== null && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <>
          {showPinnedBanner ? (
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface-raised py-1.5 ps-3 pe-2">
              <span className="flex shrink-0 items-center gap-2 font-medium text-primary-text text-xs">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full bg-primary ring-[3px] ring-primary-surface"
                />
                {stillWorkingLabel(activeThread.session?.providerName)}
              </span>
              <span role="status" className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                {pinnedDiffMessage(pinnedChangeCount)}
              </span>
              <Button size="compact" variant="ghost" className="shrink-0" onClick={applyNewestDiff}>
                Update
              </Button>
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" ref={attachDiffBody}>
            {railOpen ? (
              railHostsChanges && activeThread && activeCwd ? (
                <nav aria-label="Changed files" className={DIFF_FILE_RAIL_CLASS_NAME}>
                  <DiffFileRailHeader
                    fileCount={shownWorkingTreeFiles?.length ?? null}
                    meta={review.enabled ? `${review.viewedCount} reviewed` : null}
                  />
                  <DiffChangesPanel
                    environmentId={activeThread.environmentId}
                    cwd={activeCwd}
                    files={shownWorkingTreeFiles ?? []}
                    agentRunning={agentRunning}
                    selected={changedFileReveal}
                    onSelectFile={selectChangedFile}
                    consumeCommitFocusRequest={consumeCommitFocusRequest}
                    reviewStatusOf={review.enabled ? review.statusOf : null}
                    order={railPaths}
                    onUserChange={markUserChange}
                  />
                </nav>
              ) : (
                <DiffFileRail
                  rows={railRowsReady ? railRows : null}
                  reviewStatusOf={review.enabled ? review.statusOf : null}
                  reviewedCount={review.viewedCount}
                  currentPath={railCurrentPath ?? selectedFilePath}
                  onSelect={selectRailFile}
                />
              )
            ) : null}
            <div
              ref={diffBodyRef}
              tabIndex={-1}
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background outline-none"
            >
              {isSelectedPatchTruncated && !lazySource && (
                <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                  This preview exceeds the size limit. Changes shown are incomplete.
                  {selectedGitSource?.files ? " Totals include all changes." : ""}
                </p>
              )}
              {selectedPatchError && !renderablePatch && (
                <div className="px-3">
                  <p className="mb-2 text-[11px] text-error/80">{selectedPatchError}</p>
                </div>
              )}
              {!renderablePatch && !lazySource ? (
                isLoadingSelectedPatch ? (
                  <DiffPanelLoadingState
                    label={
                      selectedTurn
                        ? "Loading checkpoint diff..."
                        : selectedGitScope === "branch"
                          ? "Loading branch diff..."
                          : `Loading ${GIT_SCOPE_LABELS[selectedGitScope].toLowerCase()} diff...`
                    }
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                    <p>
                      {hasNoNetChanges
                        ? "No net changes in this selection."
                        : "No patch available for this selection."}
                    </p>
                  </div>
                )
              ) : lazySource || renderablePatch?.kind === "files" ? (
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <div
                    className="min-h-0 min-w-0 flex-1"
                    onClickCapture={(event) => {
                      const composedPath = event.nativeEvent.composedPath?.() ?? [];
                      for (const node of composedPath) {
                        if (!(node instanceof HTMLElement)) continue;
                        // Header controls keep their own actions. In particular, the chevron must
                        // not also trigger the row handler or the two toggles cancel each other.
                        if (
                          node instanceof HTMLButtonElement ||
                          node instanceof HTMLAnchorElement
                        ) {
                          return;
                        }
                      }
                      const title = composedPath.find(
                        (node): node is HTMLElement =>
                          node instanceof HTMLElement && node.hasAttribute("data-title"),
                      );
                      const filePath = title?.textContent;
                      // The filename remains the explicit "open in editor" affordance.
                      if (filePath) {
                        openDiffFile(filePath);
                        return;
                      }
                      const header = composedPath.find(
                        (node): node is HTMLElement =>
                          node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
                      );
                      const headerFilePath = header?.querySelector("[data-title]")?.textContent;
                      if (!headerFilePath) return;
                      const file = codeViewFiles.find(
                        (candidate) => candidate.filePath === headerFilePath,
                      );
                      if (file) toggleDiffFileCollapsed(file.fileKey);
                    }}
                    onContextMenuCapture={(event) => {
                      const composedPath = event.nativeEvent.composedPath?.() ?? [];
                      const title = composedPath.find(
                        (node): node is HTMLElement =>
                          node instanceof HTMLElement && node.hasAttribute("data-title"),
                      );
                      const filePath = title?.textContent?.trim();
                      if (!filePath) return;
                      event.preventDefault();
                      onFileContextMenu(
                        {
                          environmentId: activeThread?.environmentId ?? null,
                          filePath,
                          workspaceRoot: activeCwd,
                          repositoryRoot: activeRepositoryRoot,
                        },
                        event,
                      );
                    }}
                  >
                    <AnnotatableCodeView
                      key={collapseScopeKey ?? reviewSectionId}
                      viewerRef={setCodeView}
                      codeViewKey={`${codeViewMountKey}:${lazySource ? filePatchScope : "preview"}`}
                      className="h-full min-h-0 overflow-auto"
                      files={codeViewFiles}
                      renderCodeViewFooter={renderLoadingBoundary}
                      sectionId={reviewSectionId}
                      sectionTitle={reviewSectionTitle}
                      composerDraftTarget={composerDraftTarget}
                      renderHeaderFilenameSuffix={(fileDiff) => {
                        const path = resolveFileDiffPath(fileDiff);
                        const stat = fileStats.get(path);
                        return (
                          <>
                            <DiffFilePathCopyButton filePath={path} />
                            {stat ? (
                              <DiffFileStatus {...fileStates.get(path)} retry={() => retry(path)} />
                            ) : null}
                          </>
                        );
                      }}
                      {...(lazySource
                        ? {
                            unsafeCSSExtra:
                              "[data-additions-count], [data-deletions-count] { display: none; }",
                          }
                        : {})}
                      renderHeaderMetadata={(fileDiff: FileDiffMetadata) => {
                        const path = resolveFileDiffPath(fileDiff);
                        const stat = lazySource ? fileStats.get(path) : undefined;
                        return (
                          <span className="flex items-center gap-2">
                            {stat ? (
                              <DiffStat
                                tone="neutral"
                                additions={stat.additions}
                                deletions={stat.deletions}
                                layout="aligned"
                              />
                            ) : null}
                            {sinceReview.has(path) ? (
                              <Button
                                type="button"
                                size="compact"
                                variant="ghost"
                                aria-pressed={showingSinceReview.has(path)}
                                className={cn(
                                  "shrink-0 font-sans",
                                  showingSinceReview.has(path) &&
                                    "ring-1 ring-inset ring-primary-edge",
                                )}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSinceReview(path);
                                }}
                              >
                                {showingSinceReview.has(path)
                                  ? "Show all changes"
                                  : "Show only what changed"}
                              </Button>
                            ) : null}
                            {review.enabled ? (
                              <DiffReviewToggle
                                path={path}
                                open={
                                  !collapsedDiffFileKeys.has(buildFileDiffIdentityKey(fileDiff))
                                }
                                status={review.statusOf(path)}
                                onToggle={setFileReviewed}
                              />
                            ) : null}
                          </span>
                        );
                      }}
                      renderHeaderPrefix={(fileDiff, fileKey) => {
                        const unavailable = fileDiff.cacheKey?.endsWith(":pending") === true;
                        const collapsed = unavailable || collapsedDiffFileKeys.has(fileKey);
                        const filePath = resolveFileDiffPath(fileDiff);
                        return (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  size="icon-micro"
                                  variant="ghost"
                                  className={cn(
                                    "-ms-0.5 [--control-icon-color:currentColor] bg-transparent hover:bg-foreground/10",
                                    getDiffCollapseIconClassName(fileDiff),
                                  )}
                                  aria-label={
                                    collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`
                                  }
                                  aria-expanded={!collapsed}
                                  disabled={unavailable}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleDiffFileCollapsed(fileKey);
                                  }}
                                />
                              }
                            >
                              {collapsed ? (
                                <ChevronRightIcon className="size-4" />
                              ) : (
                                <ChevronDownIcon className="size-4" />
                              )}
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              {collapsed ? "Expand diff" : "Collapse diff"}
                            </TooltipPopup>
                          </Tooltip>
                        );
                      }}
                      options={{
                        diffStyle: diffLayout === "split" ? "split" : "unified",
                        lineDiffType: "none",
                        overflow: wordWrap ? "wrap" : "scroll",
                        theme: resolveDiffThemeName(resolvedTheme),
                        preferredHighlighter: PREFERRED_HIGHLIGHTER,
                        themeType: resolvedTheme as DiffThemeType,
                        stickyHeaders: true,
                        ...(currentLoadDiffFiles ? { loadDiffFiles } : {}),
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto p-2">
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground/75">
                      {renderablePatch?.kind === "raw" ? renderablePatch.reason : null}
                    </p>
                    <pre
                      className={cn(
                        "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                        wordWrap
                          ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                          : "overflow-auto",
                      )}
                    >
                      {renderablePatch?.kind === "raw" ? renderablePatch.text : null}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}
