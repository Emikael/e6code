import { scopedProjectKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import { useMemo } from "react";

import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import type { Project } from "../types";
import { useClientSettings } from "./useSettings";

/**
 * The name the sidebar and the draft hero show for `project`: its logical
 * project group's display name, which can differ from the project's own title
 * when grouping combines checkouts of one repository. Null without a project.
 */
export function useProjectGroupDisplayName(project: Project | null): string | null {
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const projectKey = project
    ? scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
    : null;
  return useMemo(() => {
    if (projectKey === null) return null;
    const labels = new Map(environments.map((entry) => [entry.environmentId, entry.label]));
    const group = buildSidebarProjectSnapshots({
      projects,
      settings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
    }).find((snapshot) =>
      snapshot.memberProjectRefs.some((ref) => scopedProjectKey(ref) === projectKey),
    );
    return group?.displayName ?? null;
  }, [environments, primaryEnvironmentId, projectKey, projects, settings]);
}
