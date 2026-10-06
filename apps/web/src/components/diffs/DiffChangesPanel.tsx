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
import type { EnvironmentId, VcsFileChangeKind, VcsWorkingTreeFile } from "@e6tools/contracts";
import { MinusIcon, PlusIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { memo, useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { readLocalApi } from "~/localApi";
import { cn, randomUUID } from "~/lib/utils";
import { useGitStackedAction } from "~/state/sourceControlActions";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { DiffStatLabel, hasNonZeroStat } from "../chat/DiffStatLabel";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type DiffChangesSection = "staged" | "unstaged";

interface DiffChangesPanelProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly files: ReadonlyArray<VcsWorkingTreeFile>;
  /** Discarding is blocked while the agent may still be writing these files. */
  readonly agentRunning: boolean;
  readonly selected: { readonly path: string; readonly section: DiffChangesSection } | null;
  readonly onSelectFile: (path: string, section: DiffChangesSection) => void;
}

const KIND_TONE: Record<VcsFileChangeKind, string> = {
  modified: "text-warning",
  added: "text-success",
  untracked: "text-success",
  deleted: "text-destructive-foreground",
  renamed: "text-info",
  copied: "text-info",
  "type-changed": "text-warning",
  conflicted: "text-error",
};

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
  onSelectFile,
}: DiffChangesPanelProps) {
  const selectedIn = (section: DiffChangesSection) =>
    selected?.section === section ? selected.path : null;
  const sections = useMemo(() => deriveVcsChangeSections(files), [files]);
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
      try {
        const result = await run();
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
      } finally {
        setPendingCount((count) => count - 1);
      }
    },
    [],
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
  }, [busy, commitAction, commitDisabledReason, message, stagedCount]);

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
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 p-2">
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
              <Button
                size="xs"
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
      <div className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Changes">
        {sections.conflicts.length > 0 ? (
          <ChangeSection
            title="Conflicts"
            entries={sections.conflicts}
            selectedPath={selectedIn("unstaged")}
            actions={null}
            renderRowActions={(entry) => (
              <RowAction
                label={`Mark ${entry.path} resolved`}
                disabledReason={commitPendingReason}
                onClick={() => stagePaths([entry.path])}
              >
                <PlusIcon />
              </RowAction>
            )}
            onSelect={(entry) => onSelectFile(entry.path, "unstaged")}
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
          renderRowActions={(entry) => (
            <RowAction
              label={`Unstage ${entry.path}`}
              disabledReason={commitPendingReason}
              onClick={() => unstageEntries([entry])}
            >
              <MinusIcon />
            </RowAction>
          )}
          onSelect={(entry) => onSelectFile(entry.path, "staged")}
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
          renderRowActions={(entry) => (
            <>
              <RowAction
                label={
                  entry.kind === "untracked" ? `Delete ${entry.path}` : `Discard ${entry.path}`
                }
                disabledReason={discardDisabledReason}
                onClick={() => void discardEntries([entry])}
              >
                {entry.kind === "untracked" ? <Trash2Icon /> : <Undo2Icon />}
              </RowAction>
              <RowAction
                label={`Stage ${entry.path}`}
                disabledReason={commitPendingReason}
                onClick={() => stagePaths([entry.path])}
              >
                <PlusIcon />
              </RowAction>
            </>
          )}
          onSelect={(entry) => onSelectFile(entry.path, "unstaged")}
          onToggle={commitPendingReason ? undefined : (entry) => stagePaths([entry.path])}
        />
      </div>
    </div>
  );
}

function ChangeSection(props: {
  readonly title: string;
  readonly entries: ReadonlyArray<VcsChangeEntry>;
  readonly selectedPath: string | null;
  readonly emptyHint?: string | null;
  readonly actions: ReactNode;
  readonly renderRowActions: (entry: VcsChangeEntry) => ReactNode;
  readonly onSelect: (entry: VcsChangeEntry) => void;
  /** Space on a focused row moves it to the other section. */
  readonly onToggle?: ((entry: VcsChangeEntry) => void) | undefined;
}) {
  if (props.entries.length === 0 && !props.emptyHint) return null;
  return (
    <section aria-label={`${props.title}, ${props.entries.length} files`}>
      <div className="group/section flex h-7 items-center gap-1 pr-1 pl-3 text-[11px] font-medium text-muted-foreground">
        <span className="text-foreground/80">{props.title}</span>
        <span className="tabular-nums">{props.entries.length}</span>
        <div className="ml-auto flex items-center">{props.actions}</div>
      </div>
      {props.entries.length === 0 ? (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground/80">{props.emptyHint}</p>
      ) : (
        props.entries.map((entry) => (
          <ChangeRow
            key={entry.path}
            entry={entry}
            selected={entry.path === props.selectedPath}
            actions={props.renderRowActions(entry)}
            onSelect={props.onSelect}
            onToggle={props.onToggle}
          />
        ))
      )}
    </section>
  );
}

const ChangeRow = memo(function ChangeRow(props: {
  readonly entry: VcsChangeEntry;
  readonly selected: boolean;
  readonly actions: ReactNode;
  readonly onSelect: (entry: VcsChangeEntry) => void;
  readonly onToggle: ((entry: VcsChangeEntry) => void) | undefined;
}) {
  const { entry } = props;
  const { name, directory } = splitPath(entry.path);
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
        "group/row flex h-6 items-center gap-1 pr-1 pl-3 text-xs hover:bg-accent/60",
        props.selected && "bg-accent",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${entry.previousPath ? `${entry.previousPath} renamed to ${entry.path}` : entry.path}, ${vcsChangeKindLabel(entry.kind)}${entry.mixed ? ", also in the other section" : ""}`}
        onClick={() => props.onSelect(entry)}
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 shrink truncate text-foreground">{name}</span>
        {directory ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
            {directory}
          </span>
        ) : (
          <span className="flex-1" />
        )}
      </button>
      <div className="hidden items-center group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
        {props.actions}
      </div>
      {entry.stat &&
      hasNonZeroStat({ additions: entry.stat.insertions, deletions: entry.stat.deletions }) ? (
        <DiffStatLabel
          additions={entry.stat.insertions}
          deletions={entry.stat.deletions}
          layout="inline"
          className="text-[10px] group-focus-within/row:hidden group-hover/row:hidden pointer-coarse:hidden"
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
      <span
        className={cn(
          "w-3 shrink-0 text-center font-mono text-[10px] font-semibold",
          KIND_TONE[entry.kind],
        )}
        aria-hidden
      >
        {vcsChangeKindLetter(entry.kind)}
      </span>
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
