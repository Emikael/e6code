import type { ScopedThreadRef, ThreadPullRequestLink } from "@e6tools/contracts";
import {
  resolveThreadPullRequestChains,
  visibleThreadPullRequests,
} from "@e6tools/shared/threadPullRequests";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { Fragment, useCallback, useMemo } from "react";
import { scopeProjectRef } from "@e6tools/client-runtime/environment";
import { projectScriptCwd } from "@e6tools/shared/projectScripts";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { cn } from "~/lib/utils";
import { useProject, useServerConfigs, useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { GitDefaultBranchDialog, useGitActionRunner } from "../useGitActionRunner";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openLinkPullRequestDialog } from "./LinkPullRequestDialog";
import {
  pullRequestListLines,
  threadPullRequestRowWords,
  type PullRequestListLine,
  type PullRequestRowWord,
} from "./pullRequestListLines";
import { PullRequestDiffStat } from "./pullRequestPresentation";
import { PullRequestGlyph } from "./pullRequestIcons";

const SOURCE_LABELS: Record<ThreadPullRequestLink["source"], string> = {
  manual: "Linked by you",
  created: "Created from this thread",
  agent: "Linked by the agent",
  stack: "Found in the stack",
  "stack-dismissed": "Dismissed",
};

/** The words under a row's title, joined the way the boards join them. */
function RowWords({ words }: { words: ReadonlyArray<PullRequestRowWord> }) {
  return words.map((word, index) => (
    <Fragment key={word.text}>
      {index > 0 ? (
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
      ) : null}
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1",
          word.tone === "failed"
            ? "font-medium text-error-foreground"
            : word.tone === "merged"
              ? "font-medium text-merged-foreground"
              : "text-muted-foreground",
        )}
      >
        {word.tone === "failed" ? <CircleAlertIcon aria-hidden className="size-3.5" /> : null}
        {word.tone === "merged" ? <CheckIcon aria-hidden className="size-3.5" /> : null}
        {word.text}
      </span>
    </Fragment>
  ));
}

function LinkRow({
  line,
  threadRef,
  onUnlink,
}: {
  line: PullRequestListLine;
  threadRef: ScopedThreadRef;
  onUnlink: (link: ThreadPullRequestLink) => void;
}) {
  const openPrLink = useOpenPrLink(threadRef);
  const { link, depth, stack } = line;
  const snapshot = link.snapshot;
  const settledAt =
    snapshot?.state === "merged"
      ? (snapshot.mergedAt ?? snapshot.updatedAt)
      : snapshot?.state === "closed"
        ? (snapshot.closedAt ?? snapshot.updatedAt)
        : null;
  return (
    <div
      className="relative flex w-full items-center gap-2.5 rounded-md py-2 pr-1 hover:bg-accent/60"
      // Each layer steps in under the one it targets. The step is capped: beyond a few layers
      // the indent only says "still in the stack", which the connector line already does.
      style={{ paddingLeft: `${0.625 + Math.min(depth, 3) * 1.25}rem` }}
    >
      {depth > 0 ? <span aria-hidden className="-ml-2 h-8 w-px shrink-0 bg-border/70" /> : null}
      <a
        href={link.url}
        onClick={(event) => openPrLink(event, link.url, threadRef)}
        className="flex min-w-0 flex-1 flex-col gap-0.5"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground" />
              }
            >
              #{link.number}
            </TooltipTrigger>
            <TooltipPopup>
              {SOURCE_LABELS[link.source]} · {formatRelativeTimeLabel(link.linkedAt)}
            </TooltipPopup>
          </Tooltip>
          <span className="min-w-0 truncate text-[13px] font-medium">
            {snapshot?.title ?? link.repository}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          {snapshot === null ? (
            <span className="text-muted-foreground">Not read from the host yet</span>
          ) : (
            <RowWords words={threadPullRequestRowWords(snapshot)} />
          )}
          {snapshot?.state === "open" &&
          (snapshot.additions !== undefined || snapshot.deletions !== undefined) ? (
            <>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <PullRequestDiffStat
                additions={snapshot.additions ?? 0}
                deletions={snapshot.deletions ?? 0}
                className="font-mono text-[11px] text-muted-foreground"
              />
            </>
          ) : null}
          {settledAt ? (
            <span className="text-muted-foreground">· {formatRelativeTimeLabel(settledAt)}</span>
          ) : null}
          {stack ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground" />
                }
              >
                <PullRequestGlyph.stack aria-hidden className="size-3" />
                {stack.size}
              </TooltipTrigger>
              <TooltipPopup>
                {stack.kind === "native"
                  ? `GitHub stack of ${stack.size}: merging a layer lands the ones below it.`
                  : `${stack.size} pull requests chained by base branch.`}
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </span>
      </a>
      {/* Always in view, so copy, open and unlink are never reachable by hover alone. */}
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Pull request actions for #${link.number}: copy link, open, unlink`}
              className="shrink-0 self-center"
            >
              <MoreHorizontalIcon className="size-3.5" />
            </Button>
          }
        />
        <MenuPopup align="end" side="bottom">
          <MenuItem onClick={() => void writeTextToClipboard(link.url, "link")}>
            <LinkIcon className="size-3.5" />
            Copy link
          </MenuItem>
          <MenuItem onClick={(event) => openPrLink(event, link.url, threadRef)}>
            <ArrowUpRightIcon className="size-3.5" />
            Open
          </MenuItem>
          <MenuItem onClick={() => onUnlink(link)}>
            <PullRequestGlyph.unlink className="size-3.5" />
            {link.source === "stack" ? "Dismiss from thread" : "Unlink from thread"}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}

/**
 * No linked pull requests (board 14): what the branch has that is not in one yet, Create pull
 * request through the same runner the thread's git actions use, and Link an existing one.
 */
function EmptyThreadPullRequests({
  threadRef,
  onLink,
}: {
  threadRef: ScopedThreadRef;
  onLink: () => void;
}) {
  const thread = useThreadShell(threadRef);
  const project = useProject(
    thread ? scopeProjectRef(threadRef.environmentId, thread.projectId) : null,
  );
  const gitCwd = project
    ? projectScriptCwd({
        project: { cwd: project.workspaceRoot },
        worktreePath: thread?.worktreePath ?? null,
      })
    : null;
  const { data: status } = useEnvironmentQuery(
    gitCwd === null
      ? null
      : vcsEnvironment.status({ environmentId: threadRef.environmentId, input: { cwd: gitCwd } }),
  );
  const runner = useGitActionRunner({
    gitCwd,
    activeThreadRef: threadRef,
    gitStatus: status ?? null,
  });
  const terms = runner.changeRequestTerminology;
  const ahead = status?.aheadOfDefaultCount ?? 0;
  // Only where there is something to open one from: a branch of its own, with commits the
  // default branch does not have, a remote to push to, and no change request on it yet.
  const canCreate =
    status !== undefined &&
    status !== null &&
    status.isRepo &&
    !status.isDefaultRef &&
    status.refName !== null &&
    status.pr === null &&
    (status.hasUpstream || status.hasPrimaryRemote) &&
    ahead > 0;
  return (
    <div className="p-3">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3.5">
        <p className="text-[13px] font-medium">No linked {terms.singular}s</p>
        <p className="text-sm text-muted-foreground">
          {canCreate
            ? `This branch has ${ahead} ${ahead === 1 ? "commit" : "commits"} that ${ahead === 1 ? "is" : "are"} not in a ${terms.singular} yet.`
            : `${terms.singular.charAt(0).toUpperCase()}${terms.singular.slice(1)}s the agent opens from this thread land here.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate ? (
            <Button
              size="xs"
              variant="outline"
              disabled={runner.isRunning}
              onClick={() => void runner.run({ action: "create_pr" })}
            >
              Create {terms.singular}
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={onLink}>
            Link an existing one
          </Button>
        </div>
      </div>
      <GitDefaultBranchDialog runner={runner} />
    </div>
  );
}

export function ThreadPullRequestsPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const configs = useServerConfigs();
  if (configs.get(threadRef.environmentId)?.environment.capabilities.threadPullRequests !== true) {
    return (
      <PullRequestsUnavailableState
        title="Linked pull requests unavailable"
        error="This environment does not support multiple linked pull requests."
      />
    );
  }
  return <EnabledThreadPullRequestsPanel threadRef={threadRef} />;
}

function EnabledThreadPullRequestsPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const openLinkDialog = useCallback(() => openLinkPullRequestDialog(threadRef), [threadRef]);
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest, { reportFailure: true });
  const links = useMemo(() => visibleThreadPullRequests(thread?.pullRequests ?? []), [thread]);
  const lines = useMemo(() => pullRequestListLines(resolveThreadPullRequestChains(links)), [links]);
  const handleUnlink = useCallback(
    (link: ThreadPullRequestLink) => {
      void unlink({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          host: link.host,
          repository: link.repository,
          number: link.number,
        },
      });
    },
    [threadRef, unlink],
  );
  const openCount = useMemo(
    () => links.filter((link) => link.snapshot === null || link.snapshot.state === "open").length,
    [links],
  );
  const lastSynced = useMemo(() => {
    let latest: string | null = null;
    for (const link of links) {
      const at = link.snapshot?.syncedAt;
      if (at !== undefined && (latest === null || at > latest)) latest = at;
    }
    return latest;
  }, [links]);

  if (links.length === 0) {
    return <EmptyThreadPullRequests threadRef={threadRef} onLink={openLinkDialog} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-1.5">
          {lines.map((line) => (
            <LinkRow
              key={`${line.link.host}/${line.link.repository}#${line.link.number}`}
              line={line}
              threadRef={threadRef}
              onUnlink={handleUnlink}
            />
          ))}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-2 py-1.5 text-[.7rem] text-muted-foreground">
        <span>
          {openCount} open · {links.length} linked
          {lastSynced ? ` · synced ${formatRelativeTimeLabel(lastSynced)}` : ""}
        </span>
        <Button size="xs" variant="ghost" onClick={openLinkDialog}>
          <PlusIcon className="size-3.5" />
          Link
        </Button>
      </footer>
    </div>
  );
}
