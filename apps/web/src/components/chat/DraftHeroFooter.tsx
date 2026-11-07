/**
 * Below the new-thread composer: threads that are waiting on you and commits
 * still to push, then the shortcuts that start most work. Both are quiet; the composer stays the
 * figure on the screen.
 */
import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@e6tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { ChevronRightIcon, MessageCircleQuestionIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { shortcutLabelForCommand } from "~/keybindings";
import { useProjects, useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Kbd } from "../ui/kbd";
import { selectPickUpThreads, type UnpushedCommits } from "./DraftHeroFooter.logic";

const HINTS: ReadonlyArray<readonly [KeybindingCommand, string]> = [
  ["chat.new", "New thread"],
  ["commandPalette.toggle", "Commands"],
  ["rightPanel.toggle", "Inspector"],
  ["terminal.toggle", "Terminal"],
];

const ROW_CLASS_NAME =
  "flex w-full min-w-0 cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function DraftHeroFooter({
  keybindings,
  unpushed,
  onOpenSourceControl,
}: {
  keybindings: ResolvedKeybindingsConfig;
  /** Commits on the project's branch that its remote lacks. */
  unpushed: UnpushedCommits | null;
  /** Opens the Overview, where Commit pushes or opens a pull request. */
  onOpenSourceControl: () => void;
}) {
  const router = useRouter();
  const threads = useThreadShells();
  const projects = useProjects();
  const [nowMs] = useState(Date.now);
  const picked = useMemo(() => selectPickUpThreads(threads, { limit: 3, nowMs }), [threads, nowMs]);
  const projectTitleByKey = useMemo(
    () =>
      new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project.title])),
    [projects],
  );
  const hints = HINTS.flatMap(([command, label]) => {
    const shortcut = shortcutLabelForCommand(keybindings, command);
    return shortcut ? [{ shortcut, label }] : [];
  });

  if (picked.length === 0 && !unpushed && hints.length === 0) return null;
  return (
    <div className="flex flex-col gap-5">
      {picked.length > 0 || unpushed ? (
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[11px] font-semibold text-muted-foreground">
            Pick up where you left off
          </span>
          <ul className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {picked.map(({ thread, reason }) => {
              const projectTitle = projectTitleByKey.get(
                `${thread.environmentId}:${thread.projectId}`,
              );
              return (
                <li
                  key={`${thread.environmentId}:${thread.id}`}
                  className="border-border not-last:border-b"
                >
                  <button
                    type="button"
                    onClick={() =>
                      void router.navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(
                          scopeThreadRef(thread.environmentId, thread.id),
                        ),
                      })
                    }
                    className={ROW_CLASS_NAME}
                  >
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning-surface text-warning-foreground">
                      {reason === "approval" ? (
                        <TriangleAlertIcon aria-hidden className="size-3.5" />
                      ) : (
                        <MessageCircleQuestionIcon aria-hidden className="size-3.5" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-snug">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {thread.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        <span className="font-medium text-warning-foreground">
                          {reason === "approval" ? "Needs your approval" : "Waiting on your answer"}
                        </span>
                        {projectTitle ? ` · ${projectTitle}` : ""}
                        {` · ${formatRelativeTimeLabel(thread.updatedAt)}`}
                      </span>
                    </span>
                    <ChevronRightIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              );
            })}
            {unpushed ? (
              <li className="border-border not-last:border-b">
                <button type="button" onClick={onOpenSourceControl} className={ROW_CLASS_NAME}>
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground">
                    <PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-snug">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {unpushed.count} unpushed {unpushed.count === 1 ? "commit" : "commits"} on{" "}
                      <span className="font-mono text-xs">{unpushed.refName}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {unpushed.hasOpenPullRequest
                        ? "Push them to update the pull request"
                        : "Push them or open a pull request"}
                    </span>
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {hints.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {hints.map((hint) => (
            <span key={hint.label} className="inline-flex items-center gap-1.5">
              <Kbd>{hint.shortcut}</Kbd>
              {hint.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
