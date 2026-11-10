import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@e6tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { E6Monogram } from "../E6Monogram";
import { cn } from "~/lib/utils";

// Hard-stop cyan/orange bands under the project name: the brand stripe as the
// picker's affordance, replacing a plain dotted underline.
const BRAND_UNDERLINE =
  "bg-[linear-gradient(90deg,var(--brand-cyan)_0_50%,var(--brand-orange)_50%)] bg-size-[100%_3px] bg-bottom bg-no-repeat pb-1";
import { resolveProjectSettings } from "@e6tools/shared/projectSettings";

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
  /** The model the composer sends to, such as "Claude Opus"; null before one resolves. */
  readonly agentLabel: string | null;
  /** Where the first message runs: the project's checkout or a new worktree. */
  readonly envMode: "local" | "worktree";
  /** The new worktree's base, or the checkout's branch; null when unknown. */
  readonly branch: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
  agentLabel,
  envMode,
  branch,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = useMemo(
    () => projectGroupsSpanEnvironments(projectGroups),
    [projectGroups],
  );
  const environmentMachineById = useMemo(
    () =>
      new Map(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              resolveEnvironmentMachineKind(environment.serverConfig),
            ] as const,
        ),
      ),
    [environments],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            // The trigger's accessible name comes from its visible text (the
            // project title) so the hero sentence reads naturally: an
            // aria-label here would replace the title with an action phrase
            // mid-sentence and baffle screen-reader users.
            <MenuTrigger
              className={cn(
                BRAND_UNDERLINE,
                "pointer-events-auto inline-block max-w-[min(36rem,72vw)] truncate align-baseline font-semibold text-foreground transition-[background-size] hover:bg-size-[100%_4px] focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
          }
        >
          {activeProjectDisplayName ?? "Choose a project"}
        </TooltipTrigger>
        {activeProjectDisplayName ? (
          <TooltipPopup side="top" className="max-w-80">
            {activeProjectDisplayName}
          </TooltipPopup>
        ) : null}
      </Tooltip>
      <MenuPopup align="center" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => {
            const entry = projectEntryByKey.get(value as string);
            if (!entry || value === activeProjectKey) {
              return;
            }
            const project = entry.targetProject;
            if (!draftId) {
              return;
            }
            // Project selection changes the target of the open draft in
            // place. The prompt stays in the same composer session, so the
            // sidebar only gets a draft row if the user later navigates away.
            const currentDraft = getComposerDraft(draftId);
            setLogicalProjectDraftThreadId(
              entry.group.projectKey,
              scopeProjectRef(project.environmentId, project.id),
              draftId,
            );
            if (!hasExplicitComposerModelSelection(currentDraft)) {
              applyStickyState(draftId);
              const environmentSettings = environments.find(
                (environment) => environment.environmentId === project.environmentId,
              )?.serverConfig?.settings;
              const defaultModelSelection = environmentSettings
                ? resolveProjectSettings(environmentSettings, project.id, project).settings
                    .defaultModelSelection
                : project.defaultModelSelection;
              if (defaultModelSelection) {
                setModelSelection(draftId, defaultModelSelection, {
                  replaceOptions: true,
                });
              }
            }
          }}
        >
          {projectPickerEntries.map(({ group }) => {
            return (
              <MenuRadioItem
                key={group.projectKey}
                value={group.projectKey}
                closeOnClick
                className="[&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
              >
                <ProjectFavicon project={group} className="size-4 shrink-0" />
                <Tooltip>
                  <TooltipTrigger render={<span className="block min-w-0 truncate" />}>
                    {group.displayName}
                  </TooltipTrigger>
                  <TooltipPopup side="top" className="max-w-80">
                    {group.displayName}
                  </TooltipPopup>
                </Tooltip>
                {showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={environmentMachineById}
                  />
                ) : null}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          New project
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  // The composer hero is a sentence, so the heading's accessible name must be
  // a complete sentence too. The project picker is a control rendered inline
  // in the h1; without an explicit label its widget state bleeds into the
  // announced phrase.
  const headingLabel = hasResolvedProject
    ? `What should we work on in ${activeProjectDisplayName}?`
    : canChooseProject
      ? `${activeProjectDisplayName ?? "Choose a project"} to start`
      : "Add a project to start";

  return (
    <div className="relative flex flex-col items-center gap-3">
      <E6Monogram assemble className="mb-1 size-10 shadow-xs" />
      <h1
        aria-label={headingLabel}
        className="mx-auto w-full max-w-5xl text-center text-[1.75rem] leading-[1.2] font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[2rem]"
      >
        {hasResolvedProject ? (
          <>What should we work on in {projectSelector}?</>
        ) : canChooseProject ? (
          <>{projectSelector} to start</>
        ) : (
          <>Add a project to start</>
        )}
      </h1>
      {hasResolvedProject ? (
        <p className="max-w-xl text-center text-sm text-balance text-muted-foreground">
          {agentLabel ? (
            <>
              <span className="text-foreground">{agentLabel}</span>
              {envMode === "worktree" ? " works in a new worktree" : " works in the project folder"}
              {branch ? (
                <>
                  {envMode === "worktree" ? " off " : " on "}
                  <span className="font-mono text-[0.8125rem] text-foreground">{branch}</span>
                </>
              ) : null}
              . You can steer, approve and stop it at any time.
            </>
          ) : (
            "Describe a task to start. You can steer, approve and stop the agent at any time."
          )}
        </p>
      ) : null}
    </div>
  );
}
