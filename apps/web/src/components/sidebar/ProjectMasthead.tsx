import { scopeProjectRef, scopeThreadRef } from "@e6tools/client-runtime/environment";
import { safeErrorLogAttributes } from "@e6tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import type { ProjectScript, ScopedProjectRef } from "@e6tools/contracts";
import { EnvironmentId } from "@e6tools/contracts";
import { resolveProjectScripts } from "@e6tools/shared/projectScripts";
import { useNavigate } from "@tanstack/react-router";
import { CopyIcon, EllipsisIcon, FolderOpenIcon, FoldersIcon } from "lucide-react";
import { useMemo, useRef } from "react";

import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useE6ProjectFileState } from "../../hooks/useE6ProjectFileScripts";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { environmentCatalog } from "../../connection/catalog";
import { useComposerDraftStore } from "../../composerDraftStore";
import { releaseProjectDraftUploads } from "../../lib/composerDraftUploads";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShellsForProjectRefs } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { OpenInPicker } from "../chat/OpenInPicker";
import { ProjectFavicon } from "../ProjectFavicon";
import ProjectScriptsControl from "../ProjectScriptsControl";
import type { ProjectSidebarCounts, SwitchboardStatFilter } from "../Sidebar.logic";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { useProjectScriptSettings } from "../settings/useProjectScriptSettings";
import { stackedThreadToast } from "../ui/toastHelpers";
import { toastManager } from "../ui/toast";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useSidebar } from "../ui/sidebar";
import { useProjectScriptRunTarget } from "./projectScriptRunTarget";

const STATS: ReadonlyArray<{ id: SwitchboardStatFilter; label: string }> = [
  { id: "need-you", label: "need you" },
  { id: "live", label: "live" },
  { id: "threads", label: "threads" },
  { id: "worktrees", label: "worktrees" },
];

const DISCONNECTED_PHASES = new Set(["error", "offline", "unsupported"]);
const NO_PROJECT_REFS: readonly ScopedProjectRef[] = [];

export function ProjectMasthead({
  project,
  counts,
  activeStat,
  onStatSelect,
}: {
  project: SidebarProjectSnapshot | null;
  counts: ProjectSidebarCounts;
  activeStat: SwitchboardStatFilter | null;
  onStatSelect: (stat: SwitchboardStatFilter) => void;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const activeChatProjectId = useProjectScriptRunTarget();
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const channel =
    environmentIdentificationMode === "none"
      ? null
      : resolveSidebarStageBackdropVariant(stageLabel);
  const channelLabel = resolveEnvironmentIdentificationPillLabel(stageLabel);
  const members = project?.memberProjects ?? [];
  const memberThreads = useThreadShellsForProjectRefs(
    project?.memberProjectRefs ?? NO_PROJECT_REFS,
  );
  const memberThreadsRef = useRef(memberThreads);
  memberThreadsRef.current = memberThreads;
  const chatMember = members.find((member) => member.id === activeChatProjectId) ?? null;
  const member =
    chatMember ??
    members.find((entry) => entry.environmentId === primaryEnvironmentId) ??
    members[0] ??
    null;
  const environment = member
    ? (environments.find((entry) => entry.environmentId === member.environmentId) ?? null)
    : null;
  const scriptTargets = useMemo(
    () =>
      members.flatMap((entry) => {
        const host = environments.find(
          (candidate) => candidate.environmentId === entry.environmentId,
        );
        if (!host?.serverConfig) return [];
        return [
          {
            environmentId: entry.environmentId,
            settings: host.serverConfig.settings,
            keybindings: host.serverConfig.keybindings,
            project: entry,
          },
        ];
      }),
    [environments, members],
  );
  const settings = environment?.serverConfig?.settings ?? null;
  const scripts = useMemo(
    () => (member && settings ? resolveProjectScripts(settings, member) : []),
    [member, settings],
  );
  const fileState = useE6ProjectFileState(
    member?.environmentId ?? EnvironmentId.make("none"),
    member?.workspaceRoot ?? null,
  );
  const { submit, persist } = useProjectScriptSettings(scriptTargets);
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const revealInFileManager = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  const { copyToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({ type: "success", title: "Path copied", description: path });
    },
  });

  const disconnected = project?.memberProjects.some((entry) =>
    DISCONNECTED_PHASES.has(
      environments.find(
        (environmentEntry) => environmentEntry.environmentId === entry.environmentId,
      )?.connection.phase ?? "",
    ),
  );

  const scriptRunReason = chatMember ? undefined : "Open a thread in this project to run a script";

  const runScript = (script: ProjectScript) => {
    if (!chatMember) {
      toastManager.add({
        type: "warning",
        title: "Open a thread in this project to run a script",
      });
      return;
    }
    window.dispatchEvent(
      new CustomEvent("e6code:run-project-script", {
        detail: { script, projectId: chatMember.id },
      }),
    );
  };

  const removeDisplayedProject = async () => {
    // Same one-entry removal as LegacySidebar handleRemoveProject. A grouped
    // project drops only the entry this masthead is showing.
    if (!member) return;
    const api = readLocalApi();
    if (!api) return;
    const target = member;
    const threadsForTarget = () =>
      memberThreadsRef.current.filter(
        (thread) => thread.environmentId === target.environmentId && thread.projectId === target.id,
      );
    const confirmCopy = (threadCount: number) =>
      threadCount > 0
        ? [
            `Remove project "${target.title}" and delete its ${threadCount} thread${
              threadCount === 1 ? "" : "s"
            }?`,
            `Path: ${target.workspaceRoot}`,
            ...(target.environmentLabel ? [`Environment: ${target.environmentLabel}`] : []),
            "This permanently clears conversation history for those threads and any archived threads.",
            "This removes only this project entry.",
            "This action cannot be undone.",
          ].join("\n")
        : [
            `Remove project "${target.title}"?`,
            `Path: ${target.workspaceRoot}`,
            ...(target.environmentLabel ? [`Environment: ${target.environmentLabel}`] : []),
            "This permanently clears any archived conversation history.",
            "This removes only this project entry.",
          ].join("\n");
    const deleteEntry = async () => {
      const result = await deleteProject({
        environmentId: target.environmentId,
        input: { projectId: target.id, force: true },
      });
      if (result._tag === "Failure") return result;
      const memberProjectRef = scopeProjectRef(target.environmentId, target.id);
      const draftStore = useComposerDraftStore.getState();
      releaseProjectDraftUploads(
        memberProjectRef,
        threadsForTarget().map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
      );
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(memberProjectRef);
      if (projectDraftThread) draftStore.clearDraftThread(projectDraftThread.draftId);
      draftStore.clearProjectDraftThreadId(memberProjectRef);
      return result;
    };
    const reportFailure = (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error removing project.";
      console.error("Failed to remove project", {
        projectId: target.id,
        environmentId: target.environmentId,
        ...safeErrorLogAttributes(error),
      });
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to remove "${target.title}"`,
          description: message,
        }),
      );
    };
    if (threadsForTarget().length > 0) {
      const warningToastId = toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before removing it.",
          actionVariant: "destructive",
          actionProps: {
            children: "Delete anyway",
            onClick: () => {
              void (async () => {
                toastManager.close(warningToastId);
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, 180);
                });
                const latestCount = threadsForTarget().length;
                const confirmed = await api.dialogs.confirm(confirmCopy(latestCount), {
                  variant: "destructive",
                });
                if (!confirmed) return;
                const result = await deleteEntry();
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                  reportFailure(squashAtomCommandFailure(result));
                }
              })().catch(reportFailure);
            },
          },
        }),
      );
      return;
    }
    const confirmed = await api.dialogs.confirm(confirmCopy(0), { variant: "destructive" });
    if (!confirmed) return;
    const result = await deleteEntry();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(squashAtomCommandFailure(result));
    }
  };

  const retryUnreachable = async (entries: readonly SidebarProjectGroupMember[]) => {
    for (const entry of entries) {
      const result = await retryEnvironment(entry.environmentId);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not reconnect environment",
          description: error instanceof Error ? error.message : "Failed to reconnect.",
        });
      }
    }
  };

  const unreachableMembers = members.filter((entry) =>
    DISCONNECTED_PHASES.has(
      environments.find((candidate) => candidate.environmentId === entry.environmentId)?.connection
        .phase ?? "",
    ),
  );
  const unreachableLabel =
    environments.find((entry) => entry.environmentId === unreachableMembers[0]?.environmentId)
      ?.label ?? null;

  return (
    <header className="@container/sidebar-header flex shrink-0 flex-col gap-2 border-b border-sb-border px-3 pb-2.5 pt-0">
      <div
        className={cn(
          "@container/masthead-row flex min-h-[var(--workspace-topbar-height)] min-w-0 items-center gap-2 ps-[max(0px,calc(var(--workspace-titlebar-content-left)-60px-0.75rem+0.25rem))]",
          isElectron && "drag-region",
        )}
      >
        {project ? (
          <ProjectFavicon project={project} className="size-5 shrink-0" monogramTone="solid" />
        ) : (
          <FoldersIcon aria-hidden className="size-5 shrink-0 text-sb-muted" strokeWidth={1.75} />
        )}
        <div className="min-w-[4.5rem] flex-1">
          <h2 className="truncate text-[15px] leading-5 font-semibold text-sb-foreground">
            {project?.displayName ?? "All projects"}
          </h2>
          {project ? (
            <p className="truncate font-mono text-(length:--sb-text-meta) text-sb-muted">
              {project.workspaceRoot}
            </p>
          ) : null}
        </div>
        {channel && channelLabel ? (
          <span
            data-environment-identification={channel}
            className={cn(
              "relative z-10 hidden h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10px] leading-none font-semibold tracking-wide @[18rem]/masthead-row:inline-flex",
              // State tokens hold AA on every theme; the brand inks miss it
              // on the light themes.
              channel === "nightly"
                ? "bg-(--state-approval)/12 text-(--state-approval)"
                : "bg-(--state-working)/12 text-(--state-working)",
            )}
          >
            {channelLabel}
          </span>
        ) : null}
        {project && member && environment?.serverConfig ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <ProjectScriptsControl
              presentation="toolbar"
              scripts={scripts}
              fileScripts={fileState.scripts}
              keybindings={environment.serverConfig.keybindings}
              {...(scriptRunReason ? { runDisabledReason: scriptRunReason } : {})}
              onRunScript={runScript}
              onAddScript={(input) => submit(null, input)}
              onUpdateScript={(scriptId, input) => submit(scriptId, input)}
              onDeleteScript={(scriptId) =>
                persist(
                  (current) => current.filter((script) => script.id !== scriptId),
                  scriptId,
                  null,
                )
              }
            />
            <div className="hidden @[13rem]/masthead-row:contents">
              <OpenInPicker
                environmentId={member.environmentId}
                keybindings={environment.serverConfig.keybindings}
                availableEditors={environment.serverConfig.availableEditors}
                openInCwd={member.workspaceRoot}
                compact
                enableShortcut={false}
                ariaLabel="Open project in editor"
              />
            </div>
            <Menu>
              <MenuTrigger aria-label="Project actions" className="sb-action size-7 text-sb-muted">
                <EllipsisIcon aria-hidden className="size-4" strokeWidth={1.75} />
              </MenuTrigger>
              <MenuPopup align="end" side="bottom">
                <MenuItem
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                    void navigate({
                      to: "/projects/$projectKey",
                      params: { projectKey: project.projectKey },
                    });
                  }}
                >
                  Project settings
                </MenuItem>
                <OpenInPicker
                  environmentId={member.environmentId}
                  keybindings={environment.serverConfig.keybindings}
                  availableEditors={environment.serverConfig.availableEditors}
                  openInCwd={member.workspaceRoot}
                  presentation="menu"
                  enableShortcut={false}
                />
                <MenuItem
                  onClick={() => {
                    void revealInFileManager({
                      environmentId: member.environmentId,
                      input: {
                        cwd: member.workspaceRoot,
                        editor: "file-manager",
                        reveal: true,
                      },
                    });
                  }}
                >
                  <FolderOpenIcon aria-hidden className="size-4" strokeWidth={1.75} />
                  Reveal in file manager
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    copyToClipboard(member.workspaceRoot, { path: member.workspaceRoot })
                  }
                >
                  <CopyIcon aria-hidden className="size-4" strokeWidth={1.75} />
                  Copy path
                </MenuItem>
                <MenuItem onClick={() => void removeDisplayedProject()}>Remove project</MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        ) : null}
      </div>
      {!isReady && projects.length === 0 ? (
        <div className="flex gap-2" aria-hidden>
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="h-8 flex-1 rounded-md bg-sb-hover" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1">
          {STATS.map((stat) => {
            const value =
              stat.id === "need-you"
                ? counts.needYou
                : stat.id === "live"
                  ? counts.live
                  : stat.id === "threads"
                    ? counts.threads
                    : counts.worktrees;
            const emphasized =
              (stat.id === "need-you" && value > 0) || (stat.id === "live" && value > 0);
            return (
              <button
                key={stat.id}
                type="button"
                aria-pressed={activeStat === stat.id}
                // The name repeats the visible text so it always contains it.
                aria-label={`${value} ${stat.label}, filter`}
                onClick={() => onStatSelect(stat.id)}
                className={cn(
                  "sb-action h-auto min-h-8 flex-col items-start gap-0 px-1.5 py-1",
                  value === 0 && "text-sb-muted",
                )}
              >
                <span
                  className="font-mono text-[13px] leading-4 font-semibold tabular-nums"
                  style={
                    emphasized
                      ? {
                          color:
                            stat.id === "need-you"
                              ? "var(--state-approval)"
                              : "var(--state-working)",
                        }
                      : undefined
                  }
                >
                  {value}
                </span>{" "}
                <span className="text-(length:--sb-text-meta) whitespace-nowrap text-sb-muted">
                  {stat.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {disconnected && unreachableLabel ? (
        <button
          type="button"
          className="sb-action h-auto justify-start px-1 text-left text-(length:--sb-text-meta)"
          onClick={() => {
            void retryUnreachable(unreachableMembers);
          }}
        >
          {unreachableLabel} unreachable · retry
        </button>
      ) : null}
    </header>
  );
}
