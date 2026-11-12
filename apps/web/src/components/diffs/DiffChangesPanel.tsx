import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@e6tools/client-runtime/state/runtime";
import {
  deriveVcsChangeSections,
  vcsChangeKindLabel,
  vcsChangeKindLetter,
  vcsUnstagePaths,
  type VcsChangeEntry,
} from "@e6tools/client-runtime/state/vcs";
import type { EnvironmentId, VcsWorkingTreeFile } from "@e6tools/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  MinusIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { DiffReviewStatus } from "~/diffReviewStore";
import { readLocalApi } from "~/localApi";
import { cn, randomUUID } from "~/lib/utils";
import { useGitStackedAction } from "~/state/sourceControlActions";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { DiffStat, hasNonZeroStat } from "../DiffStat";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { generatedFoldLabel, inDiffOrder, railFolderHints } from "./diffFileRail.logic";
import { diffFileTier } from "../pullRequest/pullRequestFileOrder.logic";
import { DiffReviewTick } from "./DiffReviewTick";

export type DiffChangesSection = "staged" | "unstaged";

interface DiffChangesPanelProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly files: ReadonlyArray<VcsWorkingTreeFile>;
  /** Discarding is blocked while the agent may still be writing these files. */
  readonly agentRunning: boolean;
  readonly selected: { readonly path: string; readonly section: DiffChangesSection } | null;
  /**
   * The file the reader is in, as the paging key and scrolling move it; it takes the selected
   * row over from `selected`, and `currentCaption` ("change 1 of 2") goes under it.
   */
  readonly currentPath?: string | null;
  readonly currentCaption?: string | null;
  readonly onSelectFile: (path: string, section: DiffChangesSection) => void;
  /**
   * True once per request to move focus into the commit message box, as Run details' Commit
   * makes. The owner remembers handled requests, so remounting this panel never refocuses.
   */
  readonly consumeCommitFocusRequest?: () => boolean;
  /** Each file's review mark, when the Diff tab keeps them for this scope. */
  readonly reviewStatusOf?: ((path: string) => DiffReviewStatus) | null;
  /**
   * Paths in the order the diff body shows them. Each section lists its files in this order, so
   * the list and the diff never disagree.
   */
  readonly order?: readonly string[];
  /**
   * Called once the user's stage, unstage, discard or commit has run, so a diff held still for
   * the agent's changes shows the user's own as soon as a fresh preview answers.
   */
  readonly onUserChange?: () => void;
}

function describeFailure(result: AtomCommandResult<unknown, unknown>): string {
  if (result._tag !== "Failure") return "";
  const error = squashAtomCommandFailure(result);
  if (error && typeof error === "object" && "detail" in error && typeof error.detail === "string") {
    return error.detail;
  }
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

// Untracked directories arrive as `dir/`; keep the slash on the name so they read as folders.
function splitPath(path: string) {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf("/");
  const suffix = trimmed === path ? "" : "/";
  return slash < 0
    ? { name: `${trimmed}${suffix}`, directory: "" }
    : { name: `${trimmed.slice(slash + 1)}${suffix}`, directory: trimmed.slice(0, slash) };
}

/**
 * The Git index as two editable lists, plus the commit box that consumes it. Mirrors what
 * `git status` reports, so changes made by agents or a terminal show up the same way.
 */
export function DiffChangesPanel({
  environmentId,
  cwd,
  files,
  agentRunning,
  selected,
  currentPath = null,
  currentCaption = null,
  onSelectFile,
  consumeCommitFocusRequest,
  reviewStatusOf = null,
  order,
  onUserChange,
}: DiffChangesPanelProps) {
  const commitBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!consumeCommitFocusRequest?.()) return;
    commitBoxRef.current?.querySelector("textarea")?.focus();
  }, [consumeCommitFocusRequest]);
  const selectedIn = (section: DiffChangesSection) => {
    if (currentPath === null || currentPath === selected?.path) {
      return selected?.section === section ? selected.path : null;
    }
    // Moved there by the key or by scrolling: whichever section lists the file.
    return currentPath;
  };
  const sections = useMemo(() => {
    const derived = deriveVcsChangeSections(files);
    if (!order) return derived;
    return {
      ...derived,
      conflicts: inDiffOrder(derived.conflicts, order),
      staged: inDiffOrder(derived.staged, order),
      unstaged: inDiffOrder(derived.unstaged, order),
    };
  }, [files, order]);
  // A folder is shown only where two names are easily confused, as in the rail.
  const pathsKey = files.map((file) => file.path).join("\u0000");
  const folderHints = useMemo(
    () => railFolderHints(pathsKey === "" ? [] : pathsKey.split("\u0000")),
    [pathsKey],
  );
  const stage = useAtomCommand(vcsEnvironment.stage, { reportFailure: false });
  const unstage = useAtomCommand(vcsEnvironment.unstage, { reportFailure: false });
  const discard = useAtomCommand(vcsEnvironment.discard, { reportFailure: false });
  const restoreDiscard = useAtomCommand(vcsEnvironment.restoreDiscard, { reportFailure: false });
  const scope = useMemo(() => ({ environmentId, cwd }), [environmentId, cwd]);
  const commitAction = useGitStackedAction(scope);
  const [message, setMessage] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const busy = pendingCount > 0 || commitAction.isPending;

  const runIndexCommand = useCallback(
    async (
      failureTitle: string,
      run: () => Promise<AtomCommandResult<unknown, unknown>>,
    ): Promise<AtomCommandResult<unknown, unknown> | null> => {
      setPendingCount((count) => count + 1);
      let result: AtomCommandResult<unknown, unknown>;
      try {
        result = await run();
      } finally {
        setPendingCount((count) => count - 1);
      }
      // The user's change has run; the diff can now show it.
      onUserChange?.();
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failureTitle,
            description: describeFailure(result),
          }),
        );
        return null;
      }
      return result;
    },
    [onUserChange],
  );

  const stagePaths = useCallback(
    (paths: ReadonlyArray<string>) =>
      void runIndexCommand("Couldn't stage changes", () =>
        stage({ environmentId, input: { cwd, paths: [...paths] } }),
      ),
    [cwd, environmentId, runIndexCommand, stage],
  );
  const unstageEntries = useCallback(
    (entries: ReadonlyArray<VcsChangeEntry>) =>
      void runIndexCommand("Couldn't unstage changes", () =>
        unstage({ environmentId, input: { cwd, paths: vcsUnstagePaths(entries) } }),
      ),
    [cwd, environmentId, runIndexCommand, unstage],
  );

  const discardEntries = useCallback(
    async (entries: ReadonlyArray<VcsChangeEntry>) => {
      if (entries.length === 0) return;
      const untrackedCount = entries.filter((entry) => entry.kind === "untracked").length;
      // A single untracked folder (`dir/`) can hold any number of files.
      const folder = entries.length === 1 && entries[0]!.path.endsWith("/") ? entries[0]! : null;
      if (entries.length > 1 || folder) {
        const confirmed = await readLocalApi()?.dialogs.confirm(
          [
            folder
              ? `Delete the untracked files in ${folder.path}?`
              : `Discard changes in ${entries.length} files?`,
            folder
              ? "Ignored files inside it are kept. You can undo this from the notification."
              : untrackedCount > 0
                ? `${untrackedCount} untracked ${untrackedCount === 1 ? "item" : "items"} will be deleted. You can undo this from the notification.`
                : "Staged changes are kept. You can undo this from the notification.",
          ].join("\n"),
          { variant: "destructive" },
        );
        if (!confirmed) return;
      }
      const result = await runIndexCommand("Couldn't discard changes", () =>
        discard({ environmentId, input: { cwd, paths: entries.map((entry) => entry.path) } }),
      );
      if (result?._tag !== "Success") return;
      const { backupId } = result.value as { readonly backupId: string };
      const single = entries.length === 1 ? splitPath(entries[0]!.path).name : null;
      const toastId = toastManager.add(
        stackedThreadToast({
          type: "success",
          title: single
            ? `${untrackedCount === 1 ? "Deleted" : "Discarded changes in"} ${single}`
            : `Discarded changes in ${entries.length} files`,
          timeout: 30_000,
          actionProps: {
            children: "Undo",
            onClick: () => {
              toastManager.close(toastId);
              void runIndexCommand("Couldn't undo the discard", () =>
                restoreDiscard({ environmentId, input: { cwd, backupId } }),
              );
            },
          },
        }),
      );
    },
    [cwd, discard, environmentId, restoreDiscard, runIndexCommand],
  );

  const stagedCount = sections.staged.length;
  const changedCount = sections.unstaged.length;
  const hasConflicts = sections.conflicts.length > 0;
  const commitDisabledReason = hasConflicts
    ? "Resolve conflicts before committing."
    : stagedCount === 0 && changedCount === 0
      ? "Nothing to commit."
      : null;
  const commitLabel =
    stagedCount > 0
      ? `Commit ${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`
      : "Stage all & commit";

  const commit = useCallback(async () => {
    if (commitDisabledReason || busy) return;
    const progressToastId = toastManager.add({
      type: "loading",
      title: message.trim() ? "Committing..." : "Generating commit message...",
      timeout: 0,
    });
    const result = await commitAction.run({
      actionId: randomUUID(),
      action: "commit",
      commitScope: stagedCount > 0 ? "staged" : "all",
      ...(message.trim() ? { commitMessage: message.trim() } : {}),
    });
    onUserChange?.();
    if (result._tag === "Success") {
      setMessage("");
      toastManager.update(progressToastId, {
        type: "success",
        title: result.value.toast.title,
        ...(result.value.toast.description ? { description: result.value.toast.description } : {}),
        timeout: 5_000,
      });
      return;
    }
    if (isAtomCommandInterrupted(result)) {
      toastManager.close(progressToastId);
      return;
    }
    toastManager.update(progressToastId, {
      type: "error",
      title: "Commit failed",
      description: describeFailure(result),
      timeout: 0,
    });
  }, [busy, commitAction, commitDisabledReason, message, onUserChange, stagedCount]);

  if (!sections.supported) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        Staging needs a newer E6 Code server. Update the server to stage and discard files here.
      </p>
    );
  }

  // A commit reads the index partway through; editing it meanwhile changes what gets committed.
  const commitPendingReason = commitAction.isPending ? "Wait for the commit to finish." : null;
  const discardDisabledReason = agentRunning
    ? "The agent is still working. Wait for the turn to finish before discarding."
    : commitPendingReason;

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy={busy}>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Changes">
        {sections.conflicts.length > 0 ? (
          <ChangeSection
            title="Conflicts"
            entries={sections.conflicts}
            selectedPath={selectedIn("unstaged")}
            actions={null}
            renderRowActions={(entry) => [
              {
                label: "Mark resolved",
                icon: <PlusIcon />,
                disabledReason: commitPendingReason,
                onClick: () => stagePaths([entry.path]),
              },
            ]}
            onSelect={(entry) => onSelectFile(entry.path, "unstaged")}
            reviewStatusOf={reviewStatusOf}
            folderHints={folderHints}
            currentCaption={currentCaption}
          />
        ) : null}
        <ChangeSection
          title="Staged"
          entries={sections.staged}
          selectedPath={selectedIn("staged")}
          emptyHint={
            changedCount > 0 ? "Nothing staged. Commit stages everything, or pick files." : null
          }
          actions={
            stagedCount > 0 ? (
              <RowAction
                label="Unstage all"
                disabledReason={commitPendingReason}
                onClick={() => unstageEntries(sections.staged)}
              >
                <MinusIcon />
              </RowAction>
            ) : null
          }
          renderRowActions={(entry) => [
            {
              label: "Unstage",
              icon: <MinusIcon />,
              disabledReason: commitPendingReason,
              onClick: () => unstageEntries([entry]),
            },
          ]}
          onSelect={(entry) => onSelectFile(entry.path, "staged")}
          reviewStatusOf={reviewStatusOf}
          folderHints={folderHints}
          currentCaption={currentCaption}
          onToggle={commitPendingReason ? undefined : (entry) => unstageEntries([entry])}
        />
        <ChangeSection
          title="Changes"
          entries={sections.unstaged}
          selectedPath={selectedIn("unstaged")}
          emptyHint={stagedCount === 0 && !hasConflicts ? "Working tree clean." : null}
          actions={
            changedCount > 0 ? (
              <>
                <RowAction
                  label="Discard all changes"
                  disabledReason={discardDisabledReason}
                  onClick={() => void discardEntries(sections.unstaged)}
                >
                  <Undo2Icon />
                </RowAction>
                <RowAction
                  label="Stage all"
                  disabledReason={commitPendingReason}
                  onClick={() => stagePaths(sections.unstaged.map((entry) => entry.path))}
                >
                  <PlusIcon />
                </RowAction>
              </>
            ) : null
          }
          renderRowActions={(entry) => [
            {
              label: entry.kind === "untracked" ? "Delete" : "Discard",
              icon: entry.kind === "untracked" ? <Trash2Icon /> : <Undo2Icon />,
              disabledReason: discardDisabledReason,
              destructive: true,
              onClick: () => void discardEntries([entry]),
            },
            {
              label: "Stage",
              icon: <PlusIcon />,
              disabledReason: commitPendingReason,
              onClick: () => stagePaths([entry.path]),
            },
          ]}
          onSelect={(entry) => onSelectFile(entry.path, "unstaged")}
          reviewStatusOf={reviewStatusOf}
          folderHints={folderHints}
          currentCaption={currentCaption}
          onToggle={commitPendingReason ? undefined : (entry) => stagePaths([entry.path])}
        />
      </div>
      {/* The commit box sits at the foot of the list it commits. */}
      <div ref={commitBoxRef} className="flex shrink-0 flex-col gap-1.5 border-t border-border p-2">
        <Textarea
          size="sm"
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void commit();
            }
          }}
          placeholder="Commit message (empty to generate)"
          aria-label="Commit message"
          className="text-xs"
        />
        <Tooltip>
          <TooltipTrigger
            render={
              // Outline: the review footer's step holds the screen's one fill (`panelFill.ts`).
              <Button
                size="xs"
                variant="outline"
                className="w-full"
                disabled={commitDisabledReason !== null || busy}
                onClick={() => void commit()}
              />
            }
          >
            {commitAction.isPending ? <Spinner className="size-3.5" /> : null}
            {commitLabel}
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {commitDisabledReason ??
              (stagedCount > 0
                ? "Commits only staged changes. ⌘↵"
                : "Stages every change, then commits. ⌘↵")}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

/** One action on a change row, shown as a hover button and always listed in the row's More menu. */
interface ChangeRowAction {
  /** The verb alone, such as "Stage"; the hover button adds the path to its accessible name. */
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabledReason?: string | null;
  readonly destructive?: boolean;
  readonly onClick: () => void;
}

function ChangeSection(props: {
  readonly title: string;
  readonly entries: ReadonlyArray<VcsChangeEntry>;
  readonly selectedPath: string | null;
  readonly emptyHint?: string | null;
  readonly actions: ReactNode;
  readonly renderRowActions: (entry: VcsChangeEntry) => ReadonlyArray<ChangeRowAction>;
  readonly onSelect: (entry: VcsChangeEntry) => void;
  readonly reviewStatusOf: ((path: string) => DiffReviewStatus) | null;
  readonly folderHints: ReadonlyMap<string, string | null>;
  /** Under the selected row: "change 1 of 2". */
  readonly currentCaption?: string | null;
  /** Space on a focused row moves it to the other section. */
  readonly onToggle?: ((entry: VcsChangeEntry) => void) | undefined;
}) {
  const [showGenerated, setShowGenerated] = useState(false);
  if (props.entries.length === 0 && !props.emptyHint) return null;
  const generatedCount = props.entries.filter(
    (entry) => diffFileTier(entry.path) === "generated",
  ).length;
  const shown = showGenerated
    ? props.entries
    : props.entries.filter((entry) => diffFileTier(entry.path) !== "generated");
  return (
    <section aria-label={`${props.title}, ${props.entries.length} files`}>
      <div className="group/section flex h-7 items-center gap-1 pr-1 pl-4 text-[11px] font-medium text-muted-foreground">
        <span className="text-foreground/80">{props.title}</span>
        <span className="tabular-nums">{props.entries.length}</span>
        <div className="ml-auto flex items-center">{props.actions}</div>
      </div>
      {props.entries.length === 0 ? (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">{props.emptyHint}</p>
      ) : (
        <div className="flex flex-col gap-0.5 px-2">
          {shown.map((entry) => (
            <ChangeRow
              key={entry.path}
              entry={entry}
              selected={entry.path === props.selectedPath}
              currentCaption={
                entry.path === props.selectedPath ? (props.currentCaption ?? null) : null
              }
              reviewStatus={props.reviewStatusOf?.(entry.path) ?? null}
              folder={props.folderHints.get(entry.path) ?? null}
              actions={props.renderRowActions(entry)}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
            />
          ))}
          {generatedCount > 0 ? (
            <button
              type="button"
              aria-expanded={showGenerated}
              onClick={() => setShowGenerated((current) => !current)}
              className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-muted-foreground text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {showGenerated ? (
                <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {generatedFoldLabel(generatedCount, showGenerated)}
              </span>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

const REVIEW_STATUS_WORDS: Record<DiffReviewStatus, string> = {
  reviewed: "reviewed",
  changed: "changed since review",
  unreviewed: "not reviewed",
};

const ChangeRow = memo(function ChangeRow(props: {
  readonly entry: VcsChangeEntry;
  readonly selected: boolean;
  readonly currentCaption: string | null;
  readonly reviewStatus: DiffReviewStatus | null;
  /** The folder that tells this file from one with an easily confused name. */
  readonly folder: string | null;
  readonly actions: ReadonlyArray<ChangeRowAction>;
  readonly onSelect: (entry: VcsChangeEntry) => void;
  readonly onToggle: ((entry: VcsChangeEntry) => void) | undefined;
}) {
  const { entry } = props;
  const { name } = splitPath(entry.path);
  const caption = [
    props.folder,
    props.currentCaption,
    props.reviewStatus === "changed" ? "changed since review" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " && props.onToggle) {
      event.preventDefault();
      props.onToggle(entry);
    }
  };
  return (
    <div
      aria-current={props.selected || undefined}
      className={cn(
        "group/row flex items-center gap-1 rounded-md pe-1 ps-2 text-xs",
        caption ? "min-h-[46px]" : "min-h-8",
        props.selected
          ? "bg-sidebar-row-selected ring-1 ring-inset ring-primary-edge"
          : "hover:bg-accent",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${entry.previousPath ? `${entry.previousPath} renamed to ${entry.path}` : entry.path}, ${vcsChangeKindLabel(entry.kind)}${entry.mixed ? ", also in the other section" : ""}${props.reviewStatus ? `, ${REVIEW_STATUS_WORDS[props.reviewStatus]}` : ""}`}
        onClick={() => props.onSelect(entry)}
        onKeyDown={onKeyDown}
      >
        {props.reviewStatus ? <DiffReviewTick status={props.reviewStatus} decorative /> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate font-mono text-xs",
              props.reviewStatus === "reviewed" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {name}
          </span>
          {caption ? (
            <span className="truncate text-muted-foreground text-xs">{caption}</span>
          ) : null}
        </span>
      </button>
      <div className="hidden items-center group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
        {props.actions.map((action) => (
          <RowAction
            key={action.label}
            label={`${action.label} ${entry.path}`}
            disabledReason={action.disabledReason ?? null}
            onClick={action.onClick}
          >
            {action.icon}
          </RowAction>
        ))}
      </div>
      {entry.stat &&
      hasNonZeroStat({ additions: entry.stat.insertions, deletions: entry.stat.deletions }) ? (
        <DiffStat
          tone="neutral"
          additions={entry.stat.insertions}
          deletions={entry.stat.deletions}
          className="shrink-0 text-[11px] text-muted-foreground"
        />
      ) : null}
      {entry.mixed ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            }
          />
          <TooltipPopup side="top">Also has changes in the other section</TooltipPopup>
        </Tooltip>
      ) : null}
      {/* The letter names the kind of change; the row's label says it in words. Neutral, since
          it is not a status. */}
      <span
        className="w-3 shrink-0 text-center font-mono text-[10px] font-semibold text-muted-foreground"
        aria-hidden
      >
        {vcsChangeKindLetter(entry.kind)}
      </span>
      {/* Always in view, so the row's actions never depend on hover. */}
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              size="icon-micro"
              variant="ghost"
              aria-label={`More for ${entry.path}`}
              className="size-6 shrink-0"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-40">
          {props.actions.map((action) => (
            <MenuItem
              key={action.label}
              disabled={Boolean(action.disabledReason)}
              {...(action.destructive ? { variant: "destructive" as const } : {})}
              onClick={action.onClick}
            >
              {action.icon}
              {action.disabledReason ? (
                <span className="flex min-w-0 flex-col">
                  <span>{action.label}</span>
                  <span className="text-muted-foreground text-xs">{action.disabledReason}</span>
                </span>
              ) : (
                action.label
              )}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
});

function RowAction(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabledReason?: string | null;
  readonly children: ReactNode;
}) {
  const disabled = Boolean(props.disabledReason);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-micro"
            variant="ghost"
            aria-label={props.label}
            // Keep disabled actions hoverable so the tooltip can say why.
            aria-disabled={disabled}
            className={cn(disabled && "opacity-50")}
            onClick={(event) => {
              event.stopPropagation();
              if (!disabled) props.onClick();
            }}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.disabledReason ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}
