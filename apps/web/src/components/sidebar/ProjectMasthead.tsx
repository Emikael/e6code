import type { ProjectScript } from "@e6tools/contracts";
import { EnvironmentId } from "@e6tools/contracts";
import { resolveProjectScripts } from "@e6tools/shared/projectScripts";
import { useNavigate } from "@tanstack/react-router";
import { CopyIcon, EllipsisIcon, FolderOpenIcon } from "lucide-react";
import { useMemo } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useE6ProjectFileState } from "../../hooks/useE6ProjectFileScripts";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { OpenInPicker } from "../chat/OpenInPicker";
import { ProjectFavicon } from "../ProjectFavicon";
import ProjectScriptsControl from "../ProjectScriptsControl";
import type { ProjectSidebarCounts, SwitchboardStatFilter } from "../Sidebar.logic";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useProjectScriptSettings } from "../settings/useProjectScriptSettings";
import { toastManager } from "../ui/toast";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useSidebar } from "../ui/sidebar";

const STATS: ReadonlyArray<{ id: SwitchboardStatFilter; label: string }> = [
  { id: "need-you", label: "need you" },
  { id: "live", label: "live" },
  { id: "threads", label: "threads" },
  { id: "worktrees", label: "worktrees" },
];

const DISCONNECTED_PHASES = new Set(["error", "offline", "unsupported"]);

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
  const projects = useProjects();
  const member = project?.memberProjects[0] ?? null;
  const environment = member
    ? (environments.find((entry) => entry.environmentId === member.environmentId) ?? null)
    : null;
  const settings = environment?.serverConfig?.settings ?? null;
  const scripts = useMemo(
    () => (member && settings ? resolveProjectScripts(settings, member) : []),
    [member, settings],
  );
  const fileState = useE6ProjectFileState(
    member?.environmentId ?? EnvironmentId.make("none"),
    member?.workspaceRoot ?? null,
  );
  const { submit, persist } = useProjectScriptSettings(
    member && environment?.serverConfig
      ? [
          {
            environmentId: member.environmentId,
            settings: environment.serverConfig.settings,
            keybindings: environment.serverConfig.keybindings,
            project: member,
          },
        ]
      : [],
  );
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
  const unreachable = environments.find(
    (entry) =>
      project?.memberProjects.some(
        (memberProject) => memberProject.environmentId === entry.environmentId,
      ) && DISCONNECTED_PHASES.has(entry.connection.phase),
  );

  const runScript = (script: ProjectScript) => {
    if (!member) return;
    window.dispatchEvent(
      new CustomEvent("e6code:run-project-script", {
        detail: { script, projectId: member.id },
      }),
    );
  };

  const removeProject = async () => {
    if (!member) return;
    const message = `Remove project "${member.title}"?\nPath: ${member.workspaceRoot}`;
    const api = readLocalApi();
    const confirmed = api ? await api.dialogs.confirm(message) : window.confirm(message);
    if (!confirmed) return;
    await deleteProject({
      environmentId: member.environmentId,
      input: { projectId: member.id, force: true },
    });
  };

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-sb-border px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        {project ? (
          <ProjectFavicon project={project} className="mt-0.5 size-5 shrink-0" />
        ) : (
          <span aria-hidden className="mt-0.5 size-5 shrink-0 rounded-md bg-sb-hover" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] leading-5 font-semibold text-sb-foreground">
            {project?.displayName ?? "All projects"}
          </h2>
          {project ? (
            <p className="truncate font-mono text-(length:--sb-text-meta) text-sb-muted">
              {project.workspaceRoot}
            </p>
          ) : null}
        </div>
        {project && member && environment?.serverConfig ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <ProjectScriptsControl
              presentation="toolbar"
              scripts={scripts}
              fileScripts={fileState.scripts}
              keybindings={environment.serverConfig.keybindings}
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
            <OpenInPicker
              environmentId={member.environmentId}
              keybindings={environment.serverConfig.keybindings}
              availableEditors={environment.serverConfig.availableEditors}
              openInCwd={member.workspaceRoot}
              compact
              enableShortcut={false}
            />
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
                <MenuItem onClick={() => void removeProject()}>Remove project</MenuItem>
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
                aria-label={
                  stat.id === "need-you"
                    ? `${value} threads need you, filter`
                    : `${value} ${stat.label}, filter`
                }
                onClick={() => onStatSelect(stat.id)}
                className={cn(
                  "sb-action h-auto min-h-8 flex-col gap-0 px-1 py-1",
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
                </span>
                <span className="text-(length:--sb-text-meta) text-sb-muted">{stat.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {disconnected && unreachable ? (
        <button
          type="button"
          className="sb-action h-auto justify-start px-1 text-left text-(length:--sb-text-meta)"
          onClick={() => {
            if (isMobile) setOpenMobile(false);
            void navigate({ to: "/settings/connections" });
          }}
        >
          {unreachable.label} unreachable · retry
        </button>
      ) : null}
    </header>
  );
}
